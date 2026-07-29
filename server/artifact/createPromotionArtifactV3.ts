import { hashArtifactPayload } from '../utils/hashArtifact';
import { signPayload } from '../utils/signing';
import type { PromotionArtifactV3 } from './PromotionArtifact';

export type PromotionArtifactV3Body = Omit<
  PromotionArtifactV3,
  'artifactId' | 'artifactHash' | 'signature' | 'signingKeyId'
>;

/**
 * Build an AES-1.0 sealed PromotionArtifactV3:
 * 1) hash stripped payload
 * 2) attach artifactId/artifactHash
 * 3) optionally sign stripped payloadWithHash
 */
export function createPromotionArtifactV3(
  body: PromotionArtifactV3Body,
  options?: {
    readonly privateKey?: string;
    readonly signingKeyId?: string;
  },
): PromotionArtifactV3 {
  const payloadWithoutEnvelope: Record<string, unknown> = {
    humanId: body.humanId,
    pipelineId: body.pipelineId,
    parentPromotionId: body.parentPromotionId,
    parentExecutionHash: body.parentExecutionHash,
    executionHash: body.executionHash,
    pipelineDefinitionRef: body.pipelineDefinitionRef,
    mutationChain: body.mutationChain,
    fitness: body.fitness,
    promotedAt: body.promotedAt,
    sourceExperimentId: body.sourceExperimentId,
    schemaVersion: 'promotion.v3',
    runtimeFingerprint: body.runtimeFingerprint,
    policySnapshotRef: body.policySnapshotRef,
    approvalDecision: body.approvalDecision,
    migrationNote: body.migrationNote,
  };

  // Drop undefined so canonicalize/hash stay stable across optional fields.
  for (const key of Object.keys(payloadWithoutEnvelope)) {
    if (payloadWithoutEnvelope[key] === undefined) {
      delete payloadWithoutEnvelope[key];
    }
  }

  const artifactHash = hashArtifactPayload(payloadWithoutEnvelope);
  const payloadWithHash = {
    ...payloadWithoutEnvelope,
    artifactId: artifactHash,
    artifactHash,
  };

  if (options?.privateKey) {
    const signature = signPayload(payloadWithHash, options.privateKey);
    return {
      ...(payloadWithHash as unknown as PromotionArtifactV3),
      signature,
      signingKeyId: options.signingKeyId,
    };
  }

  return payloadWithHash as unknown as PromotionArtifactV3;
}

export function promotionStoreKey(artifact: Pick<PromotionArtifactV3, 'artifactHash'>): string {
  return `promotion/${artifact.artifactHash}`;
}
