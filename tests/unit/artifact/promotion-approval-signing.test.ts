import { describe, expect, it } from 'vitest';
import {
  createApprovalRecord,
  createDefaultArtifactMigrationRegistry,
  createPromotionArtifactV3,
  promotionStoreKey,
  requirePromotionV3,
  stripEnvelope,
  type PromotionArtifactV2,
} from '../../../server/artifact';
import { hashArtifactPayload } from '../../../server/utils/hashArtifact';
import { generateKeypair, signPayload, verifySignature } from '../../../server/utils/signing';

describe('AES-1.0: WORM approval → create (no post-hoc mutation)', () => {
  const { publicKey, privateKey } = generateKeypair();
  const signingKeyId = 'ed25519:test-key';

  const approval = createApprovalRecord({
    approvalId: 'apr-run-1-g001-c000',
    subjectId: 'run-1-g001-c000',
    subjectType: 'promotion-candidate',
    decision: {
      approved: true,
      reviewer: 'auto-gate',
      reason: 'positive fitness',
      timestamp: 2000,
    },
    evolutionRunId: 'run-1',
    schemaVersion: 'approval.v1',
    createdAt: 2000,
  });

  const baseInput = {
    humanId: 'promotion-g001-c000',
    pipelineId: 'pipeline-1',
    executionHash: 'exec-hash-1',
    pipelineDefinitionRef: 'cas://sha256/def1',
    mutationChain: [{ id: 'm1', type: 'param-tweak', description: 'x' }],
    fitness: { rawFitness: 1, penalty: 0, fitness: 1 },
    promotedAt: 1000,
    sourceExperimentId: 'run-1-g001-c000',
    evolutionRunId: 'run-1',
    approvalRecordId: approval.approvalId,
    metadata: { generation: 1 },
    privateKeyBase64: privateKey,
    signingKeyId,
  };

  it('FORBID: mutating a sealed artifact with approvalDecision breaks hash/signature', () => {
    const preliminary = createPromotionArtifactV3({
      ...baseInput,
      approvalRecordId: approval.approvalId,
    });

    const mutated = {
      ...preliminary,
      approvalDecision: approval.decision,
    };

    expect(hashArtifactPayload(mutated)).not.toBe(mutated.artifactHash);
    expect(
      verifySignature(
        stripEnvelope(mutated as unknown as Record<string, unknown>),
        mutated.signature,
        publicKey,
      ),
    ).toBe(false);
  });

  it('PATTERN A (canonical): ApprovalRecord exists first; V3 seals with approvalRecordId', () => {
    expect(approval.subjectId).toBe('run-1-g001-c000');
    expect(approval.subjectType).toBe('promotion-candidate');

    const artifact = createPromotionArtifactV3({
      ...baseInput,
      approvalRecordId: approval.approvalId,
    });

    expect(artifact.approvalRecordId).toBe(approval.approvalId);
    expect(hashArtifactPayload(artifact)).toBe(artifact.artifactHash);
    expect(
      verifySignature(
        stripEnvelope(artifact as unknown as Record<string, unknown>),
        artifact.signature,
        publicKey,
      ),
    ).toBe(true);
  });

  it('PATTERN B: new approvalRecordId yields a NEW artifactId (lineage must follow the new id)', () => {
    const first = createPromotionArtifactV3({
      ...baseInput,
      approvalRecordId: 'apr-a',
    });
    const second = createPromotionArtifactV3({
      ...baseInput,
      approvalRecordId: 'apr-b',
    });

    expect(second.artifactId).not.toBe(first.artifactId);
    expect(second.artifactHash).toBe(hashArtifactPayload(second));
    expect(
      verifySignature(
        stripEnvelope(second as unknown as Record<string, unknown>),
        second.signature,
        publicKey,
      ),
    ).toBe(true);
  });

  it('evolutionRunId is present and does not require parsing sourceExperimentId', () => {
    const artifact = createPromotionArtifactV3(baseInput);
    expect(artifact.evolutionRunId).toBe('run-1');
  });

  it('create without approvalRecordId throws', () => {
    expect(() =>
      createPromotionArtifactV3({
        ...baseInput,
        approvalRecordId: '',
      }),
    ).toThrow(/approvalRecordId/);
  });

  it('parent lineage: raw v2 is migrated via requirePromotionV3 with legacy approvalRecordId', () => {
    const rawV2Parent: PromotionArtifactV2 = {
      id: 'promotion-g000-c000',
      pipelineId: 'pipeline-1',
      executionHash: 'exec-hash-0',
      pipelineDefinition: { id: 'pipeline-1', version: '1', nodes: [] },
      mutationChain: [],
      fitness: { rawFitness: 1, penalty: 0, fitness: 1 },
      promotedAt: 1,
      schemaVersion: 'promotion.v2',
      artifactHash: 'sha256:legacy',
      sourceExperimentId: 'run-0',
    };

    expect(rawV2Parent.schemaVersion).not.toBe('promotion.v3');

    const migrated = requirePromotionV3(rawV2Parent, createDefaultArtifactMigrationRegistry());
    expect(migrated.schemaVersion).toBe('promotion.v3');
    expect(migrated.signature).toBeUndefined();
    expect(migrated.approvalRecordId).toBe('legacy:unlinked:promotion-g000-c000');
    expect(migrated.migrationNote).toBe('unsigned-after-migration:promotion.v2->promotion.v3');
    expect(promotionStoreKey(migrated)).toBe(`promotion/${migrated.artifactHash}`);
  });

  it('forged signature over unrelated payload does not verify', () => {
    const artifact = createPromotionArtifactV3(baseInput);
    const forged = signPayload({ id: 'x', schemaVersion: 'promotion.v2' }, privateKey);
    expect(verifySignature(artifact as unknown as Record<string, unknown>, forged, publicKey)).toBe(false);
  });
});
