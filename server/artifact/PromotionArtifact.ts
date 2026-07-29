import type { FitnessResult } from '../evolve/FitnessResult';
import type { MutationRecord } from '../evolve/MutationTypes';

export interface ApprovalDecision {
  readonly approved: boolean;
  readonly reviewer?: string;
  readonly reason?: string;
  readonly timestamp: number;
}

/**
 * Legacy promotion artifact (pre-AES / promotion.v2).
 * Prefer {@link PromotionArtifactV3} for new writes.
 */
export interface PromotionArtifactV2 {
  readonly id: string;
  readonly pipelineId: string;
  readonly parentPromotionId?: string;
  readonly parentExecutionHash?: string;
  readonly executionHash: string;
  readonly pipelineDefinition: unknown;
  readonly mutationChain: readonly MutationRecord[];
  readonly fitness: FitnessResult;
  readonly promotedAt: number;
  readonly schemaVersion: 'promotion.v2';
  readonly artifactHash: string;
  readonly sourceExperimentId: string;
  readonly approvalDecision?: ApprovalDecision;
  /** Pre-AES optional fields some stores may carry. */
  readonly signature?: string;
  readonly signingKeyId?: string;
}

/** @deprecated Use PromotionArtifactV2 or PromotionArtifactV3 explicitly. */
export type PromotionArtifact = PromotionArtifactV2;

/**
 * AES-1.0 promotion artifact (promotion.v3).
 *
 * - `artifactId` === `artifactHash` (content-addressed store key).
 * - `humanId` is the readable, non-content-addressed promotion label.
 * - Envelope fields (`artifactHash`, `artifactId`, `signature`, `signingKeyId`)
 *   must never enter payload hash or signature bytes.
 */
export interface PromotionArtifactV3 {
  readonly humanId: string;
  readonly pipelineId: string;
  readonly parentPromotionId?: string;
  readonly parentExecutionHash?: string;
  readonly executionHash: string;
  /** Content-addressed or store ref to pipeline definition (not the full inline graph). */
  readonly pipelineDefinitionRef: string;
  readonly mutationChain: readonly MutationRecord[];
  readonly fitness: FitnessResult;
  readonly promotedAt: number;
  readonly sourceExperimentId: string;
  readonly schemaVersion: 'promotion.v3';
  readonly runtimeFingerprint?: string;
  readonly policySnapshotRef?: string;
  readonly approvalDecision?: ApprovalDecision;
  /** Set when schema migration cleared a prior signature. */
  readonly migrationNote?: string;

  /** AES envelope — content-addressed identity (= artifactHash). */
  readonly artifactId: string;
  readonly artifactHash: string;
  readonly signature?: string;
  readonly signingKeyId?: string;
}

export type PromotionSchemaVersion = PromotionArtifactV2['schemaVersion'] | PromotionArtifactV3['schemaVersion'];
