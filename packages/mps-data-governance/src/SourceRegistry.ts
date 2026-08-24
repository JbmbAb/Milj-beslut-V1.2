import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  LocalPemSigningKeyProvider,
  LocalPemVerificationKeyProvider,
  canonicalizeStrict,
  verifyArtifactAttestation,
  type ArtifactAttestation,
  type SigningKeyProvider,
  type VerificationKeyProvider,
} from '@miljobeslut/mimers-brunn-core';

export const SOURCE_REGISTRY_APPROVAL_PREDICATE_TYPE =
  'mimers-brunn/source-registry-approval/v1' as const;
export const SOURCE_APPROVAL_ACTION = 'source.approve' as const;
export const SOURCE_REGISTRY_ATTESTATION_SCHEMA_VERSION = 1 as const;

export interface SourceProducer {
  readonly producer_id: string;
  readonly name: string;
  readonly type: 'court' | 'county_board' | 'municipality' | 'agency' | 'other';
}

export interface SourceChannel {
  readonly channel_type: 'WMS' | 'WFS' | 'API' | 'WEBSITE' | 'FTP' | 'DATASET_PORTAL';
  readonly endpoint_url?: string;
  readonly allowed_domains: readonly string[];
}

export interface SourceRetryPolicy {
  readonly max_attempts: number;
  readonly backoff: 'EXPONENTIAL' | 'FIXED';
}

export interface SourcePolicy {
  readonly rate_limit_requests_per_second: number;
  readonly concurrency_limit: number;
  readonly politeness_delay_ms?: number;
  readonly max_object_size_bytes?: number;
  readonly retry_policy: SourceRetryPolicy;
}

export interface SourceChangeDetection {
  readonly strategy: 'ETAG' | 'LAST_MODIFIED' | 'CONTENT_HASH' | 'NONE';
}

export interface SourceRegistryArtifact {
  readonly artifact_id: string;
  readonly artifact_type: 'SOURCE_REGISTRY_ENTRY';
  readonly source_id: string;
  readonly producer: SourceProducer;
  readonly channel: SourceChannel;
  readonly adapter: string;
  readonly artifact_types: readonly string[];
  readonly collection_frequency: 'HOURLY' | 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY' | 'ON_DEMAND';
  readonly change_detection: SourceChangeDetection;
  readonly policy: SourcePolicy;
  readonly geographic_scope?: string;
  readonly lifecycle_state: 'REGISTERED' | 'APPROVED' | 'REJECTED' | 'QUARANTINED';
  readonly approval_attestation: ArtifactAttestation;
}

export interface SourceApprovalAttestationPredicate {
  readonly action: typeof SOURCE_APPROVAL_ACTION;
  readonly source_id: string;
  readonly source_content_hash: string;
  readonly approver_actor_id: string;
  readonly approver_role: 'GOVERNANCE_REVIEWER';
  readonly attestation_schema_version: typeof SOURCE_REGISTRY_ATTESTATION_SCHEMA_VERSION;
  readonly signer_key_id: string;
}

export type RuntimeFrequency = 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'on_demand';

export interface VerifiedSourceDefinition {
  readonly sourceId: string;
  readonly authority: {
    readonly name: string;
    readonly type: 'court' | 'county_board' | 'municipality' | 'other';
  };
  readonly endpointUrl?: string;
  readonly adapter: string;
  readonly frequency: RuntimeFrequency;
  readonly allowedDomains: readonly string[];
  readonly artifactTypes: readonly string[];
  readonly policy: SourcePolicy;
  readonly registryArtifactId: string;
  readonly sourceContentHash: string;
}

export interface VerifiedSourceRegistry {
  readonly registryPath: string;
  readonly sources: readonly VerifiedSourceDefinition[];
  getSource(sourceId: string): VerifiedSourceDefinition | null;
  isUrlAllowedForSource(sourceId: string, url: string): boolean;
}

export function calculateSourceRegistryContentHash(artifact: Omit<SourceRegistryArtifact, 'approval_attestation'>): string {
  const content = {
    source_id: artifact.source_id,
    producer: artifact.producer,
    channel: artifact.channel,
    adapter: artifact.adapter,
    artifact_types: artifact.artifact_types,
    collection_frequency: artifact.collection_frequency,
    change_detection: artifact.change_detection,
    policy: artifact.policy,
    geographic_scope: artifact.geographic_scope ?? null,
  };
  return createHash('sha256').update(canonicalizeStrict(content), 'utf8').digest('hex');
}

export function sourceRegistryArtifactForHash(
  artifact: SourceRegistryArtifact,
): Omit<SourceRegistryArtifact, 'approval_attestation'> {
  const { approval_attestation: _approvalAttestation, ...unsigned } = artifact;
  return unsigned;
}

/**
 * P2-SR-VERIFY-ONLY-01 — takes a `VerificationKeyProvider`, not a signer.
 *
 * Materializing an approved source is a read: it checks that someone with GOVERNOR authority
 * already signed this entry. It never mints anything. Demanding a signer here was what forced
 * the private key into every runtime that merely wanted to read the registry.
 */
export async function verifySourceRegistryArtifact(
  artifact: SourceRegistryArtifact,
  signing: VerificationKeyProvider,
): Promise<VerifiedSourceDefinition> {
  assertSourceRegistryShape(artifact);

  if (artifact.lifecycle_state !== 'APPROVED') {
    throw new Error(
      `SourceRegistryArtifact '${artifact.source_id}' is ${artifact.lifecycle_state}; only APPROVED sources may materialize.`,
    );
  }

  const sourceContentHash = calculateSourceRegistryContentHash(sourceRegistryArtifactForHash(artifact));
  const attestation = artifact.approval_attestation;
  const predicate = attestation.predicate as Partial<SourceApprovalAttestationPredicate>;

  const checks = [
    ['signature_valid', await verifyArtifactAttestation(attestation, signing)],
    ['predicate_type', attestation.predicateType === SOURCE_REGISTRY_APPROVAL_PREDICATE_TYPE],
    ['signer_key', attestation.signer === signing.keyId && predicate.signer_key_id === signing.keyId],
    ['subject_digest', attestation.subjectDigest === `sha256:${sourceContentHash}`],
    ['action', predicate.action === SOURCE_APPROVAL_ACTION],
    ['source_id', predicate.source_id === artifact.source_id],
    ['source_content_hash', predicate.source_content_hash === sourceContentHash],
    ['approver_role', predicate.approver_role === 'GOVERNANCE_REVIEWER'],
    [
      'attestation_schema_version',
      predicate.attestation_schema_version === SOURCE_REGISTRY_ATTESTATION_SCHEMA_VERSION,
    ],
    ['approver_actor_id', typeof predicate.approver_actor_id === 'string' && predicate.approver_actor_id.length > 0],
  ] as const;

  const failed = checks.filter(([, ok]) => !ok).map(([name]) => name);
  if (failed.length > 0) {
    throw new Error(
      `SourceRegistryArtifact '${artifact.source_id}' failed approval binding checks: ${failed.join(', ')}`,
    );
  }

  return {
    sourceId: artifact.source_id,
    authority: {
      name: artifact.producer.name,
      type: materializeAuthorityType(artifact.producer.type),
    },
    endpointUrl: artifact.channel.endpoint_url,
    adapter: artifact.adapter,
    frequency: materializeFrequency(artifact.collection_frequency),
    allowedDomains: [...artifact.channel.allowed_domains],
    artifactTypes: [...artifact.artifact_types],
    policy: artifact.policy,
    registryArtifactId: artifact.artifact_id,
    sourceContentHash,
  };
}

/**
 * SOURCE-REGISTRY-MULTI-KEY-VERIFICATION-V1.
 *
 * Resolves the trusted `VerificationKeyProvider` for one specific `entry.approval_attestation.
 * signer` id, rather than assuming a single registry-wide key. This is what lets a historical
 * entry (signed by a retired governor key) and a newly-approved entry (signed by its successor)
 * coexist and each verify against the exact key that actually signed it — the trust principle is
 * "resolve by claimed signer, then verify against exactly that key", never "verify everything
 * against whichever one key this host happens to have configured."
 *
 * An unrecognized signer id resolves to `null` and MUST deny (fail the whole registry load, per
 * `loadVerifiedSourceRegistry`'s atomic-verification semantics) rather than silently skip that
 * entry — an entry from an untrusted signer is not "not yet verified", it is untrusted.
 */
export interface SourceRegistryTrustedKeyring {
  resolve(keyId: string): VerificationKeyProvider | null;
}

/** Builds a keyring from an explicit, in-memory key_id -> public key PEM map. */
export function createSourceRegistryTrustedKeyring(
  publicKeysByKeyId: ReadonlyMap<string, string>,
): SourceRegistryTrustedKeyring {
  return {
    resolve(keyId: string): VerificationKeyProvider | null {
      const publicKeyPem = publicKeysByKeyId.get(keyId);
      return publicKeyPem ? new LocalPemVerificationKeyProvider(keyId, publicKeyPem) : null;
    },
  };
}

function readJsonString(text: string, start: number): { value: string; end: number } {
  let cursor = start + 1;
  let escaped = false;
  while (cursor < text.length) {
    const character = text[cursor]!;
    if (!escaped && character === '"') {
      return { value: JSON.parse(text.slice(start, cursor + 1)) as string, end: cursor + 1 };
    }
    escaped = !escaped && character === '\\';
    if (character !== '\\') escaped = false;
    cursor += 1;
  }
  throw new Error('SOURCE_REGISTRY_TRUSTED_KEYS_FILE contains an unterminated JSON string.');
}

function skipJsonValue(text: string, start: number): number {
  let cursor = start;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (; cursor < text.length; cursor += 1) {
    const character = text[cursor]!;
    if (inString) {
      if (!escaped && character === '"') inString = false;
      escaped = !escaped && character === '\\';
      if (character !== '\\') escaped = false;
      continue;
    }
    if (character === '"') { inString = true; continue; }
    if (character === '{' || character === '[') depth += 1;
    else if (character === '}' || character === ']') {
      if (depth === 0) return cursor;
      depth -= 1;
    } else if (character === ',' && depth === 0) return cursor;
  }
  return cursor;
}

/** Detect duplicate top-level object properties before JSON.parse collapses them. */
function assertNoDuplicateTrustedKeyIds(text: string): void {
  let cursor = 0;
  const skipWhitespace = () => { while (/\s/.test(text[cursor] ?? '')) cursor += 1; };
  skipWhitespace();
  if (text[cursor] !== '{') return;
  cursor += 1;
  const seen = new Set<string>();
  while (true) {
    skipWhitespace();
    if (text[cursor] === '}') return;
    if (text[cursor] !== '"') return;
    const key = readJsonString(text, cursor);
    if (seen.has(key.value)) {
      throw new Error(`SOURCE_REGISTRY_TRUSTED_KEYS_FILE contains duplicate key_id '${key.value}'.`);
    }
    seen.add(key.value);
    cursor = key.end; skipWhitespace();
    if (text[cursor] !== ':') return;
    cursor = skipJsonValue(text, cursor + 1); skipWhitespace();
    if (text[cursor] === '}') return;
    if (text[cursor] !== ',') return;
    cursor += 1;
  }
}

/**
 * P2-SR-VERIFY-ONLY-01 — the runtime read path. Verification capability only. No private key is
 * read here in either the single-key or multi-key shape below.
 *
 * Multi-key shape (preferred): `SOURCE_REGISTRY_TRUSTED_KEYS_FILE` names a JSON file mapping
 * `key_id -> public key PEM` for every trusted historical and current governor key. Adding a
 * successor key is editing this file, never rewriting or re-signing existing registry entries.
 *
 * Single-key shape (backward compatible): if the file is not configured, falls back to the
 * original `SOURCE_REGISTRY_SIGNING_KEY_ID` / `SOURCE_REGISTRY_SIGNING_PUBLIC_KEY_PEM` pair,
 * producing a keyring that trusts exactly that one key — unchanged behavior for any deployment
 * that has not yet needed a second governor key.
 */
export function getSourceRegistryTrustedKeyringFromEnv(): SourceRegistryTrustedKeyring {
  const trustedKeysFile = process.env.SOURCE_REGISTRY_TRUSTED_KEYS_FILE;
  if (trustedKeysFile) {
    const text = readFileSync(resolve(trustedKeysFile), 'utf8');
    assertNoDuplicateTrustedKeyIds(text);
    const raw = JSON.parse(text) as Record<string, string>;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error(
        `SOURCE_REGISTRY_TRUSTED_KEYS_FILE at '${trustedKeysFile}' must be a JSON object mapping key_id -> public key PEM.`,
      );
    }
    return createSourceRegistryTrustedKeyring(new Map(Object.entries(raw)));
  }

  const keyId = process.env.SOURCE_REGISTRY_SIGNING_KEY_ID;
  const publicKeyPem = process.env.SOURCE_REGISTRY_SIGNING_PUBLIC_KEY_PEM;
  if (!keyId || !publicKeyPem) {
    throw new Error(
      'SourceRegistry verification requires either SOURCE_REGISTRY_TRUSTED_KEYS_FILE (multi-key) ' +
        'or both SOURCE_REGISTRY_SIGNING_KEY_ID and SOURCE_REGISTRY_SIGNING_PUBLIC_KEY_PEM ' +
        '(single-key). An unverified registry is not a registry: without a trusted public key ' +
        'nothing can distinguish an approved source from an invented one.',
    );
  }
  return createSourceRegistryTrustedKeyring(new Map([[keyId, publicKeyPem]]));
}

/**
 * P2-SR-VERIFY-ONLY-01 — the runtime read path. Verification capability only.
 *
 * The default key provider is now verify-only, so a harvest host needs the key id and the PUBLIC
 * key and nothing else. It previously defaulted to `getSourceRegistrySigningKeyFromEnv()`, which
 * required `SOURCE_REGISTRY_SIGNING_PRIVATE_KEY_PEM` — meaning any host that could read the
 * registry could also mint an APPROVED attestation for a source nobody reviewed.
 *
 * A signer still satisfies the parameter, because signing extends verification. That is
 * deliberate: the approval tooling loads the registry back through this same function to
 * self-verify what it just wrote, and must not need a second code path to do it.
 *
 * `signing` (single explicit key, historical shape) and `trustedKeyring` (multi-key,
 * SOURCE-REGISTRY-MULTI-KEY-VERIFICATION-V1) are mutually exclusive knobs on the same atomic
 * load: passing `signing` reproduces the exact original behavior (every entry must be signed by
 * that one key, including callers that already rely on this); omitting it resolves each entry's
 * key independently through the keyring. Atomicity is unchanged either way — one untrusted or
 * invalid entry still fails the whole load; this is multi-key TRUST RESOLUTION, not partial
 * success.
 */
export async function loadVerifiedSourceRegistry(args: {
  readonly registryPath?: string;
  readonly signing?: VerificationKeyProvider;
  readonly trustedKeyring?: SourceRegistryTrustedKeyring;
} = {}): Promise<VerifiedSourceRegistry> {
  const registryPath = args.registryPath ?? getSourceRegistryPathFromEnv();
  const raw = JSON.parse(readFileSync(registryPath, 'utf8')) as SourceRegistryArtifact[];

  if (!Array.isArray(raw)) {
    throw new Error(`Source Registry at '${registryPath}' must be a JSON array.`);
  }

  // Lazy: only resolved when actually needed, so a caller that supplies `signing` explicitly
  // (the historical single-key shape, reproduced byte-for-byte below) never requires the
  // multi-key env/file configuration to be present at all.
  let lazyKeyring: SourceRegistryTrustedKeyring | undefined;
  const keyringFor = (): SourceRegistryTrustedKeyring =>
    (lazyKeyring ??= args.trustedKeyring ?? getSourceRegistryTrustedKeyringFromEnv());

  const resolveKeyForEntry = (entry: SourceRegistryArtifact): VerificationKeyProvider => {
    if (args.signing) {
      // Historical single-key shape, reproduced exactly: `verifySourceRegistryArtifact` itself
      // performs the `signer_key` binding check (and produces that check's own error message) --
      // this branch must not duplicate or preempt it with a differently-worded guard.
      return args.signing;
    }
    const claimedSignerId = entry.approval_attestation?.signer;
    const resolved = claimedSignerId ? keyringFor().resolve(claimedSignerId) : null;
    if (!resolved) {
      throw new Error(
        `SourceRegistryArtifact '${entry.source_id}' is signed by an untrusted key ` +
          `'${claimedSignerId ?? 'unknown'}' -- not present in the trusted keyring.`,
      );
    }
    return resolved;
  };

  const sources = await Promise.all(
    raw.map((entry) => verifySourceRegistryArtifact(entry, resolveKeyForEntry(entry))),
  );
  assertNoDuplicateSourceIds(sources, registryPath);

  return {
    registryPath,
    sources,
    // First-match resolution below is unambiguous only because of the guard above: see
    // P2-SR-DUP-ID-01 in `assertNoDuplicateSourceIds`.
    getSource(sourceId: string): VerifiedSourceDefinition | null {
      return sources.find((source) => source.sourceId === sourceId) ?? null;
    },
    isUrlAllowedForSource(sourceId: string, url: string): boolean {
      const source = sources.find((candidate) => candidate.sourceId === sourceId);
      return source ? isUrlAllowedForVerifiedSource(source, url) : false;
    },
  };
}

export async function getVerifiedSourceDefinition(sourceId: string): Promise<VerifiedSourceDefinition | null> {
  const registry = await loadVerifiedSourceRegistry();
  return registry.getSource(sourceId);
}

export async function getAllVerifiedSources(): Promise<readonly VerifiedSourceDefinition[]> {
  const registry = await loadVerifiedSourceRegistry();
  return registry.sources;
}

export function isUrlAllowedForVerifiedSource(source: VerifiedSourceDefinition, url: string): boolean {
  try {
    const parsedUrl = new URL(url);
    const hostname = parsedUrl.hostname.toLowerCase();
    return source.allowedDomains.some((domain) => {
      const normalized = domain.toLowerCase();
      return hostname === normalized || hostname.endsWith(`.${normalized}`);
    });
  } catch {
    return false;
  }
}

export function getSourceRegistryPathFromEnv(): string {
  return resolve(process.env.SOURCE_REGISTRY_ARTIFACT_PATH ?? 'source-registry/national-registry.json');
}

/**
 * P2-SR-VERIFY-ONLY-01 — the runtime key path. No private key, no minting.
 *
 * Requires only the key id and the public key. `SOURCE_REGISTRY_SIGNING_PRIVATE_KEY_PEM` is not
 * read here, so a harvest host configured through this function cannot sign even if the private
 * key happens to be present in its environment: the returned provider has no `sign` method.
 *
 * The key id is required rather than derived, because `verifySourceRegistryArtifact` binds
 * `attestation.signer === signing.keyId`. Without it, an attestation signed by an unexpected key
 * would still verify against whatever public key the host happened to be given.
 */
export function getSourceRegistryVerificationKeyFromEnv(): VerificationKeyProvider {
  const keyId = process.env.SOURCE_REGISTRY_SIGNING_KEY_ID;
  const publicKeyPem = process.env.SOURCE_REGISTRY_SIGNING_PUBLIC_KEY_PEM;

  if (!keyId || !publicKeyPem) {
    throw new Error(
      'SourceRegistry verification requires SOURCE_REGISTRY_SIGNING_KEY_ID and ' +
        'SOURCE_REGISTRY_SIGNING_PUBLIC_KEY_PEM. An unverified registry is not a registry: ' +
        'without the public key nothing can distinguish an approved source from an invented one.',
    );
  }

  return new LocalPemVerificationKeyProvider(keyId, publicKeyPem);
}

/**
 * The GOVERNOR minting path. Still requires the private key — see `approveSourceRegistryEntry`.
 *
 * Kept separate from `getSourceRegistryVerificationKeyFromEnv` so that the environment a host
 * needs states its capability: a host with only the public key can read, and only a host
 * deliberately given the private key can approve.
 */
export function getSourceRegistrySigningKeyFromEnv(): SigningKeyProvider {
  const keyId = process.env.SOURCE_REGISTRY_SIGNING_KEY_ID;
  const privateKeyPem = process.env.SOURCE_REGISTRY_SIGNING_PRIVATE_KEY_PEM;
  const publicKeyPem = process.env.SOURCE_REGISTRY_SIGNING_PUBLIC_KEY_PEM;

  if (!keyId || !privateKeyPem || !publicKeyPem) {
    throw new Error(
      'Canonical SourceRegistry materialization requires SOURCE_REGISTRY_SIGNING_KEY_ID, ' +
        'SOURCE_REGISTRY_SIGNING_PRIVATE_KEY_PEM and SOURCE_REGISTRY_SIGNING_PUBLIC_KEY_PEM.',
    );
  }

  return new LocalPemSigningKeyProvider(keyId, privateKeyPem, publicKeyPem);
}

/**
 * P2-SR-DUP-ID-01 — a source_id resolves to exactly one authority, or the load FAILS CLOSED.
 *
 * `getSource` and `isUrlAllowedForSource` resolve by first match. That is only an answer if the
 * match is unique. Two APPROVED entries sharing a source_id — the shape an authority reissue takes
 * when the superseded entry is left APPROVED alongside its replacement — would let the harvest run
 * under whichever happens to sit earlier in the JSON array, quite possibly the stale scope, while
 * the download manifest binds that entry's `registry_artifact_id` as the thing that authorised the
 * run. Every signature in the chain would still verify; nothing downstream could tell.
 *
 * So ambiguity is refused at load, the same way `verifySourceRegistryArtifact` refuses a
 * non-APPROVED lifecycle_state: the whole registry fails, rather than one entry being quietly
 * preferred over another. Reissue therefore means removing (or de-APPROVING) the entry being
 * replaced, and the registry says so out loud when it has not happened.
 *
 * Only APPROVED entries can reach here — a non-APPROVED one has already thrown — so uniqueness
 * over `sources` is uniqueness over the APPROVED set.
 */
function assertNoDuplicateSourceIds(
  sources: readonly VerifiedSourceDefinition[],
  registryPath: string,
): void {
  const bySourceId = new Map<string, string[]>();
  for (const source of sources) {
    const artifactIds = bySourceId.get(source.sourceId);
    if (artifactIds) artifactIds.push(source.registryArtifactId);
    else bySourceId.set(source.sourceId, [source.registryArtifactId]);
  }

  const duplicates = [...bySourceId.entries()].filter(([, artifactIds]) => artifactIds.length > 1);
  if (duplicates.length === 0) return;

  // Every conflict, not just the first: an operator fixing a reissue needs to see the whole set.
  const detail = duplicates
    .map(([sourceId, artifactIds]) => `'${sourceId}' (artifact_ids: ${artifactIds.join(', ')})`)
    .join('; ');

  throw new Error(
    `Source Registry at '${registryPath}' has duplicate APPROVED source_id entries: ${detail}. ` +
      'A source_id must resolve to exactly one approved authority; with more than one, ' +
      'getSource() would silently return whichever appears first in the file and a harvest could ' +
      'run under a superseded scope while recording the wrong registry_artifact_id as its ' +
      'authorisation. Withdraw the superseded entry before approving its replacement.',
  );
}

function assertSourceRegistryShape(artifact: SourceRegistryArtifact): void {
  if (!artifact || artifact.artifact_type !== 'SOURCE_REGISTRY_ENTRY') {
    throw new Error('Invalid SourceRegistryArtifact: artifact_type must be SOURCE_REGISTRY_ENTRY.');
  }
  if (!artifact.source_id || !artifact.producer?.producer_id || !artifact.producer?.name) {
    throw new Error('Invalid SourceRegistryArtifact: source_id and producer identity are required.');
  }
  if (!artifact.channel || artifact.channel.allowed_domains.length === 0) {
    throw new Error(`Invalid SourceRegistryArtifact '${artifact.source_id}': allowed_domains is required.`);
  }
  if (!artifact.adapter) {
    throw new Error(`Invalid SourceRegistryArtifact '${artifact.source_id}': adapter is required.`);
  }
  if (!artifact.change_detection?.strategy) {
    throw new Error(`Invalid SourceRegistryArtifact '${artifact.source_id}': change_detection.strategy is required.`);
  }
  if (!artifact.policy?.retry_policy) {
    throw new Error(`Invalid SourceRegistryArtifact '${artifact.source_id}': policy.retry_policy is required.`);
  }
  if (!artifact.approval_attestation) {
    throw new Error(`Invalid SourceRegistryArtifact '${artifact.source_id}': approval_attestation is required.`);
  }
}

function materializeAuthorityType(
  type: SourceProducer['type'],
): VerifiedSourceDefinition['authority']['type'] {
  return type === 'agency' ? 'other' : type;
}

function materializeFrequency(frequency: SourceRegistryArtifact['collection_frequency']): RuntimeFrequency {
  return frequency.toLowerCase() as RuntimeFrequency;
}
