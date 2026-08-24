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

/**
 * SOURCE-REGISTRY-MULTI-KEY-VERIFICATION-V1.
 *
 * Verification keys are an explicit trust set, not a fallback sequence. An entry selects its
 * verifier by its attested signer id; an unknown signer is rejected before signature checking.
 * This lets historical entries remain verifiable during a governor-key successor transition
 * without allowing a newly configured key to silently validate an older entry.
 */
export class SourceRegistryVerificationKeyring {
  private readonly byKeyId: ReadonlyMap<string, VerificationKeyProvider>;

  constructor(keys: readonly VerificationKeyProvider[]) {
    if (keys.length === 0) {
      throw new Error('Source Registry verification keyring must contain at least one public key.');
    }
    const byKeyId = new Map<string, VerificationKeyProvider>();
    for (const key of keys) {
      if (!key?.keyId) throw new Error('Source Registry verification keyring contains a key without keyId.');
      if (byKeyId.has(key.keyId)) {
        throw new Error(`Source Registry verification keyring contains duplicate key id '${key.keyId}'.`);
      }
      byKeyId.set(key.keyId, key);
    }
    this.byKeyId = byKeyId;
  }

  resolve(keyId: string): VerificationKeyProvider | null {
    return this.byKeyId.get(keyId) ?? null;
  }
}

export type SourceRegistryVerificationAuthority =
  | VerificationKeyProvider
  | SourceRegistryVerificationKeyring;

function resolveVerificationKey(
  artifact: SourceRegistryArtifact,
  authority: SourceRegistryVerificationAuthority,
): VerificationKeyProvider | null {
  if (authority instanceof SourceRegistryVerificationKeyring) {
    return authority.resolve(artifact.approval_attestation?.signer ?? '');
  }
  return authority;
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
  authority: SourceRegistryVerificationAuthority,
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
  const signing = resolveVerificationKey(artifact, authority);

  if (!signing) {
    throw new Error(
      `SourceRegistryArtifact '${artifact.source_id}' is signed by unknown or untrusted key ` +
        `'${attestation.signer}'.`,
    );
  }

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
 */
export async function loadVerifiedSourceRegistry(args: {
  readonly registryPath?: string;
  /** Multi-key V1 trust path. Every entry selects exactly one key by attestation signer. */
  readonly verificationKeyring?: SourceRegistryVerificationKeyring;
  /** Compatibility port for existing single-key callers. */
  readonly signing?: VerificationKeyProvider;
} = {}): Promise<VerifiedSourceRegistry> {
  const registryPath = args.registryPath ?? getSourceRegistryPathFromEnv();
  if (args.verificationKeyring && args.signing) {
    throw new Error('Source Registry load accepts either verificationKeyring or signing, never both.');
  }
  const authority = args.verificationKeyring ?? args.signing ?? getSourceRegistryVerificationKeyringFromEnv();
  const raw = JSON.parse(readFileSync(registryPath, 'utf8')) as SourceRegistryArtifact[];

  if (!Array.isArray(raw)) {
    throw new Error(`Source Registry at '${registryPath}' must be a JSON array.`);
  }

  const sources = await Promise.all(raw.map((entry) => verifySourceRegistryArtifact(entry, authority)));
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

interface SourceRegistryTrustedPublicKeyEnvironment {
  readonly key_id: string;
  readonly public_key_pem: string;
}

/**
 * Returns the V1 keyring from explicit public-key-only configuration.
 *
 * `SOURCE_REGISTRY_TRUSTED_PUBLIC_KEYS_JSON` is a JSON array of
 * `{ key_id, public_key_pem }`. When absent, the established single-key environment remains a
 * singleton trust set so existing deployments retain their exact verification semantics.
 */
export function getSourceRegistryVerificationKeyringFromEnv(): SourceRegistryVerificationKeyring {
  const configured = process.env.SOURCE_REGISTRY_TRUSTED_PUBLIC_KEYS_JSON;
  if (!configured) {
    return new SourceRegistryVerificationKeyring([getSourceRegistryVerificationKeyFromEnv()]);
  }

  let entries: unknown;
  try {
    entries = JSON.parse(configured);
  } catch {
    throw new Error('SOURCE_REGISTRY_TRUSTED_PUBLIC_KEYS_JSON must be valid JSON.');
  }
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error('SOURCE_REGISTRY_TRUSTED_PUBLIC_KEYS_JSON must be a non-empty array.');
  }

  const keys = entries.map((entry, index) => {
    const value = entry as Partial<SourceRegistryTrustedPublicKeyEnvironment>;
    if (!value || typeof value.key_id !== 'string' || !value.key_id ||
      typeof value.public_key_pem !== 'string' || !value.public_key_pem) {
      throw new Error(
        `SOURCE_REGISTRY_TRUSTED_PUBLIC_KEYS_JSON entry ${index} requires key_id and public_key_pem.`,
      );
    }
    return new LocalPemVerificationKeyProvider(value.key_id, value.public_key_pem);
  });
  return new SourceRegistryVerificationKeyring(keys);
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
