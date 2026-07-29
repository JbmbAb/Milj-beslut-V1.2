import { describe, expect, it } from 'vitest';
import {
  ArtifactMigrationRegistry,
  createDefaultArtifactMigrationRegistry,
  createPromotionArtifactV3,
  promotionStoreKey,
  stripEnvelope,
  type PromotionArtifactV2,
} from '../../../server/artifact';
import { hashArtifactPayload } from '../../../server/utils/hashArtifact';
import { generateAesKeyPair, signPayload, verifySignature } from '../../../server/utils/signing';

const fitness = {
  rawFitness: 0.9,
  penalty: 0,
  fitness: 0.9,
};

function sampleV2(overrides: Partial<PromotionArtifactV2> = {}): PromotionArtifactV2 {
  const base = {
    id: 'promotion-exp-1',
    pipelineId: 'pipe-1',
    parentExecutionHash: 'sha256:parent',
    executionHash: 'sha256:exec',
    pipelineDefinition: { id: 'pipe-1', version: '1', nodes: [] },
    mutationChain: [],
    fitness,
    promotedAt: 1_700_000_000_000,
    schemaVersion: 'promotion.v2' as const,
    sourceExperimentId: 'exp-1',
  };
  const artifactHash = hashArtifactPayload(base);
  return {
    ...base,
    artifactHash,
    signature: 'ed25519:STALE_SIGNATURE_FROM_V2',
    signingKeyId: 'key-v2-legacy',
    ...overrides,
  };
}

describe('AES-1.0 envelope', () => {
  it('excludes envelope fields from payload hash', () => {
    const body = {
      humanId: 'promotion-a',
      pipelineId: 'p1',
      executionHash: 'sha256:e',
      pipelineDefinitionRef: 'definition:x',
      mutationChain: [],
      fitness,
      promotedAt: 1,
      sourceExperimentId: 'e1',
      schemaVersion: 'promotion.v3',
    };

    const h1 = hashArtifactPayload(body);
    const h2 = hashArtifactPayload({
      ...body,
      artifactHash: 'sha256:noise',
      artifactId: 'sha256:noise',
      signature: 'ed25519:abc',
      signingKeyId: 'k1',
    });

    expect(h1).toBe(h2);
    expect(h1.startsWith('sha256:')).toBe(true);
  });

  it('stripEnvelope is idempotent for envelope keys', () => {
    const once = stripEnvelope({
      a: 1,
      artifactHash: 'h',
      artifactId: 'i',
      signature: 's',
      signingKeyId: 'k',
    });
    expect(once).toEqual({ a: 1 });
    expect(stripEnvelope(once as Record<string, unknown>)).toEqual({ a: 1 });
  });

  it('creates signed v3 artifact with matching verify and store key', () => {
    const { publicKey, privateKey } = generateAesKeyPair();
    const artifact = createPromotionArtifactV3(
      {
        humanId: 'promotion-exp-new',
        pipelineId: 'pipe-1',
        executionHash: 'sha256:exec',
        pipelineDefinitionRef: 'definition:abc',
        mutationChain: [],
        fitness,
        promotedAt: 42,
        sourceExperimentId: 'exp-new',
        evolutionRunId: 'run-exp-new',
        approvalRecordId: 'apr-exp-new',
        schemaVersion: 'promotion.v3',
        runtimeFingerprint: 'rt-1',
        policySnapshotRef: 'policy:1',
      },
      { privateKey, signingKeyId: 'test-key-1' },
    );

    expect(artifact.artifactId).toBe(artifact.artifactHash);
    expect(artifact.humanId).toBe('promotion-exp-new');
    expect(artifact.signature?.startsWith('ed25519:')).toBe(true);
    expect(artifact.signingKeyId).toBe('test-key-1');
    expect(promotionStoreKey(artifact)).toBe(`promotion/${artifact.artifactHash}`);

    expect(verifySignature(artifact as unknown as Record<string, unknown>, artifact.signature, publicKey)).toBe(
      true,
    );

    // Tamper body → verify fails
    const tampered = { ...artifact, pipelineId: 'pipe-TAMPERED' };
    expect(verifySignature(tampered as unknown as Record<string, unknown>, artifact.signature, publicKey)).toBe(
      false,
    );
  });

  it('migrates v2 → v3: recomputes hash and clears stale signatures', () => {
    const registry = createDefaultArtifactMigrationRegistry();
    const v2 = sampleV2();

    const v3 = registry.migrateToLatest(v2);

    expect(v3.schemaVersion).toBe('promotion.v3');
    expect(v3.humanId).toBe(v2.id);
    expect(v3.artifactId).toBe(v3.artifactHash);
    expect(v3.signature).toBeUndefined();
    expect(v3.signingKeyId).toBeUndefined();
    expect(v3.migrationNote).toBe('unsigned-after-migration:promotion.v2->promotion.v3');
    expect(v3.pipelineDefinitionRef.startsWith('definition:')).toBe(true);
    expect(v3.approvalRecordId).toBe('legacy:unlinked:promotion-exp-1');

    // Hash must match AES over stripped migrated body (no envelope / no stale sig).
    const expectedHash = hashArtifactPayload({
      humanId: v3.humanId,
      pipelineId: v3.pipelineId,
      parentExecutionHash: v3.parentExecutionHash,
      executionHash: v3.executionHash,
      pipelineDefinitionRef: v3.pipelineDefinitionRef,
      mutationChain: v3.mutationChain,
      fitness: v3.fitness,
      promotedAt: v3.promotedAt,
      sourceExperimentId: v3.sourceExperimentId,
      evolutionRunId: v3.evolutionRunId,
      approvalRecordId: v3.approvalRecordId,
      schemaVersion: 'promotion.v3',
      migrationNote: v3.migrationNote,
    });
    expect(v3.artifactHash).toBe(expectedHash);

    // Old v2 signature must not verify against v3 payload.
    const { publicKey, privateKey } = generateAesKeyPair();
    const forged = signPayload({ id: v2.id, schemaVersion: 'promotion.v2' }, privateKey);
    expect(verifySignature(v3 as unknown as Record<string, unknown>, forged, publicKey)).toBe(false);
    expect(verifySignature(v3 as unknown as Record<string, unknown>, v2.signature, publicKey)).toBe(false);
  });

  it('migrateToLatest is identity for already-v3 artifacts', () => {
    const registry = new ArtifactMigrationRegistry();
    const artifact = createPromotionArtifactV3({
      humanId: 'h1',
      pipelineId: 'p',
      executionHash: 'sha256:e',
      pipelineDefinitionRef: 'definition:z',
      mutationChain: [],
      fitness,
      promotedAt: 1,
      sourceExperimentId: 'e',
      evolutionRunId: 'run-e',
      approvalRecordId: 'apr-e',
      schemaVersion: 'promotion.v3',
    });
    expect(registry.migrateToLatest(artifact)).toBe(artifact);
  });
});
