import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  LocalPemSigningKeyProvider,
  createArtifactAttestation,
} from '@miljobeslut/mimers-brunn-core';
import {
  SOURCE_APPROVAL_ACTION,
  SOURCE_REGISTRY_APPROVAL_PREDICATE_TYPE,
  SOURCE_REGISTRY_ATTESTATION_SCHEMA_VERSION,
  calculateSourceRegistryContentHash,
  type SourceApprovalAttestationPredicate,
  type SourceRegistryArtifact,
} from '../../../packages/mps-data-governance/src/SourceRegistry';

export async function writeVerifiedSourceRegistryFixture(
  dir: string,
  options: {
    readonly sources?: readonly string[];
    readonly keyId?: string;
  } = {},
): Promise<{
  readonly registryPath: string;
  readonly keyId: string;
  readonly privateKeyPem: string;
  readonly publicKeyPem: string;
}> {
  const keyId = options.keyId ?? 'ed25519:test-source-registry';
  const { provider, privateKey, publicKey } = LocalPemSigningKeyProvider.generate(keyId);
  const sourceIds = options.sources ?? ['mmd_nacka'];
  const entries: SourceRegistryArtifact[] = [];

  for (const sourceId of sourceIds) {
    const unsigned = buildUnsignedSource(sourceId);
    const sourceContentHash = calculateSourceRegistryContentHash(unsigned);
    const predicate: SourceApprovalAttestationPredicate = {
      action: SOURCE_APPROVAL_ACTION,
      source_id: unsigned.source_id,
      source_content_hash: sourceContentHash,
      approver_actor_id: 'test-governance-reviewer',
      approver_role: 'GOVERNANCE_REVIEWER',
      attestation_schema_version: SOURCE_REGISTRY_ATTESTATION_SCHEMA_VERSION,
      signer_key_id: keyId,
    };

    const approval_attestation = await createArtifactAttestation({
      subjectDigest: `sha256:${sourceContentHash}`,
      predicateType: SOURCE_REGISTRY_APPROVAL_PREDICATE_TYPE,
      predicate: predicate as unknown as Record<string, unknown>,
      signing: provider,
    });

    entries.push({ ...unsigned, approval_attestation });
  }

  const registryPath = path.join(dir, 'source-registry.fixture.json');
  fs.writeFileSync(registryPath, JSON.stringify(entries, null, 2), 'utf8');

  return { registryPath, keyId, privateKeyPem: privateKey, publicKeyPem: publicKey };
}

export function installSourceRegistryFixtureEnv(fixture: {
  readonly registryPath: string;
  readonly keyId: string;
  readonly privateKeyPem: string;
  readonly publicKeyPem: string;
}): void {
  process.env.SOURCE_REGISTRY_ARTIFACT_PATH = fixture.registryPath;
  process.env.SOURCE_REGISTRY_SIGNING_KEY_ID = fixture.keyId;
  process.env.SOURCE_REGISTRY_SIGNING_PRIVATE_KEY_PEM = fixture.privateKeyPem;
  process.env.SOURCE_REGISTRY_SIGNING_PUBLIC_KEY_PEM = fixture.publicKeyPem;
}

function buildUnsignedSource(
  sourceId: string,
): Omit<SourceRegistryArtifact, 'approval_attestation'> {
  if (sourceId === 'domstol_rss') {
    return buildUnsignedDomstolRssSource();
  }
  return buildUnsignedMmdSource(sourceId);
}

function buildUnsignedMmdSource(
  sourceId: string,
): Omit<SourceRegistryArtifact, 'approval_attestation'> {
  return {
    artifact_id: `reg-${sourceId}-001`,
    artifact_type: 'SOURCE_REGISTRY_ENTRY',
    source_id: sourceId,
    producer: {
      producer_id: 'domstolsverket',
      name: 'Mark- och miljödomstolen vid Nacka tingsrätt',
      type: 'court',
    },
    channel: {
      channel_type: 'WEBSITE',
      endpoint_url: 'https://www.domstol.se/nacka-tingsratt/',
      allowed_domains: ['domstol.se'],
    },
    adapter: 'mmd_v1',
    artifact_types: ['decision', 'mkb', 'technical_description', 'control_program'],
    collection_frequency: 'DAILY',
    change_detection: { strategy: 'NONE' },
    policy: {
      rate_limit_requests_per_second: 5,
      concurrency_limit: 1,
      politeness_delay_ms: 0,
      retry_policy: { max_attempts: 1, backoff: 'FIXED' },
    },
    geographic_scope: 'Nacka tingsrätt, mark- och miljödomstol',
    lifecycle_state: 'APPROVED',
  };
}

function buildUnsignedDomstolRssSource(): Omit<SourceRegistryArtifact, 'approval_attestation'> {
  return {
    artifact_id: 'reg-domstol-rss-001',
    artifact_type: 'SOURCE_REGISTRY_ENTRY',
    source_id: 'domstol_rss',
    producer: {
      producer_id: 'domstolsverket',
      name: 'Domstolsverket',
      type: 'agency',
    },
    channel: {
      channel_type: 'WEBSITE',
      endpoint_url: 'https://www.domstol.se/feed/15972/?scope=decision&searchPageId=15972',
      allowed_domains: ['domstol.se'],
    },
    adapter: 'domstol_rss_v1',
    artifact_types: ['judgment', 'legal_source'],
    collection_frequency: 'DAILY',
    change_detection: { strategy: 'NONE' },
    policy: {
      rate_limit_requests_per_second: 1,
      concurrency_limit: 1,
      politeness_delay_ms: 0,
      retry_policy: { max_attempts: 1, backoff: 'FIXED' },
    },
    geographic_scope: 'Sverige',
    lifecycle_state: 'APPROVED',
  };
}
