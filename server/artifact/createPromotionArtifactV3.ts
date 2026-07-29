import { hashArtifactPayload } from '../utils/hashArtifact';
import { signPayload } from '../utils/signing';
import type { PromotionArtifactV3 } from './PromotionArtifact';
import type { SigningKeyProvider } from './signingKeyProvider';

export type PromotionArtifactV3Body = Omit<
  PromotionArtifactV3,
  'artifactId' | 'artifactHash' | 'signature' | 'signingKeyId'
>;

/** Signing material accepted on the create input; never part of the hashed payload. */
export type PromotionArtifactV3CreateInput = PromotionArtifactV3Body & {
  readonly privateKey?: string;
  /** Alias for {@link privateKey} (PEM or DER base64). */
  readonly privateKeyBase64?: string;
  readonly signingKeyId?: string;
};

/**
 * Build an AES-1.0 sealed PromotionArtifactV3 (WORM, post-approval only):
 * 1) hash stripped payload (includes required approvalRecordId)
 * 2) attach artifactId/artifactHash
 * 3) optionally sign stripped payloadWithHash
 */
export function createPromotionArtifactV3(
  input: PromotionArtifactV3CreateInput,
  options?: {
    readonly privateKey?: string;
    readonly signingKeyId?: string;
    readonly signingKeyProvider?: SigningKeyProvider;
  },
): PromotionArtifactV3 {
  if (!input.approvalRecordId) {
    throw new Error('PromotionArtifactV3 requires approvalRecordId (WORM: create only after approval)');
  }

  const {
    privateKey: inputPrivateKey,
    privateKeyBase64,
    signingKeyId: inputSigningKeyId,
    ...body
  } = input;

  const provider = options?.signingKeyProvider;
  let privateKey = options?.privateKey ?? inputPrivateKey ?? privateKeyBase64;
  let signingKeyId = options?.signingKeyId ?? inputSigningKeyId ?? provider?.signingKeyId;

  if (!privateKey && provider) {
    const key = provider.getPrivateKey();
    if (typeof key !== 'string') {
      throw new Error('SigningKeyProvider.getPrivateKey() is async; use createPromotionArtifactV3Async');
    }
    privateKey = key;
  }

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
    evolutionRunId: body.evolutionRunId,
    approvalRecordId: body.approvalRecordId,
    schemaVersion: 'promotion.v3',
    manifestHash: body.manifestHash,
    runtimeFingerprint: body.runtimeFingerprint,
    policySnapshotRef: body.policySnapshotRef,
    metadata: body.metadata,
    migrationNote: body.migrationNote,
  };

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

  if (privateKey) {
    const signature = signPayload(payloadWithHash, privateKey);
    return {
      ...(payloadWithHash as unknown as PromotionArtifactV3),
      signature,
      signingKeyId,
    };
  }

  return payloadWithHash as unknown as PromotionArtifactV3;
}

export async function createPromotionArtifactV3Async(
  input: PromotionArtifactV3CreateInput,
  options?: {
    readonly signingKeyProvider?: SigningKeyProvider;
    readonly privateKey?: string;
    readonly signingKeyId?: string;
  },
): Promise<PromotionArtifactV3> {
  const provider = options?.signingKeyProvider;
  let privateKey = options?.privateKey ?? input.privateKey ?? input.privateKeyBase64;
  let signingKeyId = options?.signingKeyId ?? input.signingKeyId;
  if (provider) {
    privateKey = privateKey ?? (await provider.getPrivateKey());
    signingKeyId = signingKeyId ?? provider.signingKeyId;
  }
  const { privateKey: _pk, privateKeyBase64: _b64, signingKeyId: _sk, ...body } = input;
  return createPromotionArtifactV3(
    { ...body, privateKey, signingKeyId },
    { privateKey, signingKeyId },
  );
}

export function promotionStoreKey(artifact: Pick<PromotionArtifactV3, 'artifactHash'>): string {
  return `promotion/${artifact.artifactHash}`;
}
