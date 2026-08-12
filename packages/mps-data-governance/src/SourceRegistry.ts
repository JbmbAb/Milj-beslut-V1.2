import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  LocalPemSigningKeyProvider,
  canonicalizeStrict,
  verifyArtifactAttestation,
  type ArtifactAttestation,
  type SigningKeyProvider,
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

export async function verifySourceRegistryArtifact(
  artifact: SourceRegistryArtifact,
  signing: SigningKeyProvider,
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

export async function loadVerifiedSourceRegistry(args: {
  readonly registryPath?: string;
  readonly signing?: SigningKeyProvider;
} = {}): Promise<VerifiedSourceRegistry> {
  const registryPath = args.registryPath ?? getSourceRegistryPathFromEnv();
  const signing = args.signing ?? getSourceRegistrySigningKeyFromEnv();
  const raw = JSON.parse(readFileSync(registryPath, 'utf8')) as SourceRegistryArtifact[];

  if (!Array.isArray(raw)) {
    throw new Error(`Source Registry at '${registryPath}' must be a JSON array.`);
  }

  const sources = await Promise.all(raw.map((entry) => verifySourceRegistryArtifact(entry, signing)));
  return {
    registryPath,
    sources,
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
