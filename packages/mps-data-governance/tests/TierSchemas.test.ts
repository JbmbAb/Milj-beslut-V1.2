import { describe, it, expect } from 'vitest';
import {
  SOURCE_APPROVAL_ACTION,
  SOURCE_REGISTRY_APPROVAL_PREDICATE_TYPE,
  SOURCE_REGISTRY_ATTESTATION_SCHEMA_VERSION,
  calculateSourceRegistryContentHash,
  type SourceRegistryArtifact,
} from '../src/SourceRegistry';
import type { RawSourceArtifact } from '../src/RawSourceArtifact';
import type { InventoryArtifact } from '../src/InventoryArtifact';
import type { KnowledgeCorpusDecisionArtifact } from '../src/KnowledgeCorpusDecision';

describe('Tier 1-4 Artifact Schemas', () => {
  it('should allow creating a valid SourceRegistryArtifact (Tier 1)', () => {
    const unsigned = {
      artifact_id: 'reg-001',
      artifact_type: 'SOURCE_REGISTRY_ENTRY',
      source_id: 'sgu-geodata-wfs',
      producer: {
        producer_id: 'SGU',
        name: 'Sveriges geologiska undersökning',
        type: 'agency',
      },
      channel: {
        channel_type: 'WFS',
        endpoint_url: 'https://api.sgu.se/geodata/wfs',
        allowed_domains: ['api.sgu.se'],
      },
      adapter: 'sgu_wfs_v1',
      artifact_types: ['geodata'],
      collection_frequency: 'MONTHLY',
      change_detection: { strategy: 'ETAG' },
      policy: {
        rate_limit_requests_per_second: 5,
        concurrency_limit: 1,
        politeness_delay_ms: 1000,
        retry_policy: { max_attempts: 3, backoff: 'EXPONENTIAL' },
      },
      lifecycle_state: 'APPROVED',
    } satisfies Omit<SourceRegistryArtifact, 'approval_attestation'>;

    const sourceHash = calculateSourceRegistryContentHash(unsigned);
    const artifact: SourceRegistryArtifact = {
      ...unsigned,
      approval_attestation: {
        subjectDigest: `sha256:${sourceHash}`,
        predicateType: SOURCE_REGISTRY_APPROVAL_PREDICATE_TYPE,
        predicate: {
          action: SOURCE_APPROVAL_ACTION,
          source_id: unsigned.source_id,
          source_content_hash: sourceHash,
          approver_actor_id: 'admin',
          approver_role: 'GOVERNANCE_REVIEWER',
          attestation_schema_version: SOURCE_REGISTRY_ATTESTATION_SCHEMA_VERSION,
          signer_key_id: 'ed25519:test-source-registry',
        },
        hashAlgorithm: 'sha256',
        signatureAlgorithm: 'Ed25519',
        signer: 'ed25519:test-source-registry',
        signature: 'ed25519:test-signature-placeholder',
      },
    };
    expect(artifact.artifact_type).toBe('SOURCE_REGISTRY_ENTRY');
    expect(artifact.policy.concurrency_limit).toBe(1);
    expect(artifact.channel.allowed_domains).toContain('api.sgu.se');
  });

  it('should allow creating a valid RawSourceArtifact (Tier 2)', () => {
    const artifact: RawSourceArtifact = {
      artifact_id: 'raw-001',
      artifact_type: 'RAW_SOURCE_ARTIFACT',
      source_registry_ref: { artifact_id: 'reg-001', sha256_hash: 'hash' },
      original_url: 'https://api.sgu.se/geodata/wfs?request=getCapabilities',
      harvested_at: { iso8601: '2026-08-09T13:00:00Z', unix_ms: 10000000 },
      mime_type: 'application/xml',
      sha256_hash: 'abcdef1234567890',
      byte_size: 1024
    };
    expect(artifact.artifact_type).toBe('RAW_SOURCE_ARTIFACT');
    expect(artifact.sha256_hash).toBe('abcdef1234567890');
  });

  it('should allow creating a valid InventoryArtifact (Tier 3)', () => {
    const artifact: InventoryArtifact = {
      artifact_id: 'inv-001',
      artifact_type: 'INVENTORY_ARTIFACT',
      raw_source_ref: { artifact_id: 'raw-001', sha256_hash: 'abcdef1234567890' },
      classification: 'RELEVANT',
      metadata: {
        title: 'SGU Geodata WFS Capabilities'
      },
      inventoried_at: { iso8601: '2026-08-09T14:00:00Z', unix_ms: 10000000 }
    };
    expect(artifact.artifact_type).toBe('INVENTORY_ARTIFACT');
    expect(artifact.classification).toBe('RELEVANT');
  });

  it('should allow creating a valid KnowledgeCorpusDecisionArtifact (Tier 4)', () => {
    const artifact: KnowledgeCorpusDecisionArtifact = {
      artifact_id: 'decision-001',
      artifact_type: 'KNOWLEDGE_CORPUS_DECISION',
      source_id: 'SGU',
      inventory_id: { artifact_id: 'inv-001', sha256_hash: 'hash' },
      policy_version: 'v3.0.0',
      classification: 'IRRELEVANT',
      decision: 'EXCLUDE',
      reason_code: 'TECHNICAL_METADATA_ONLY',
      decided_at: { iso8601: '2026-08-09T15:00:00Z', unix_ms: 10000000 },
      decided_by: { actor_id: 'Mimer Bibliotekarie', role: 'SYSTEM' },
      raw_reference: { artifact_id: 'raw-001', sha256_hash: 'abcdef1234567890' }
    };
    expect(artifact.artifact_type).toBe('KNOWLEDGE_CORPUS_DECISION');
    expect(artifact.decision).toBe('EXCLUDE');
  });
});
