import type { FitnessResult } from '../evolve/FitnessResult';
import type { MutationRecord } from '../evolve/MutationTypes';
import type { ApprovalDecision } from './ApprovalRecord';

export type { ApprovalDecision } from './ApprovalRecord';

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
 * AES-1.0 promotion artifact (promotion.v3) — WORM, post-approval only.
 *
 * Invariant: `promotion/{artifactId}` contains only approved V3 artifacts.
 * Rejected candidates have no promotion post; revision = ExperimentRecord + ApprovalRecord.
 *
 * - `artifactId` === `artifactHash` (content-addressed store key).
 * - `humanId` is the readable, non-content-addressed promotion label.
 * - `approvalRecordId` is required and points at the ApprovalRecord that authorized creation.
 * - Envelope fields must never enter payload hash or signature bytes.
 *
 * Rollback (future ActivationController) must be a new RollbackRecord, never a mutation of this artifact.
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
  /**
   * Stable evolution-run identity. Do not parse this from `sourceExperimentId`
   * (run ids may themselves contain hyphens).
   */
  readonly evolutionRunId: string;
  /** Required — artifact exists only after ApprovalRecord was written. */
  readonly approvalRecordId: string;
  readonly schemaVersion: 'promotion.v3';
  /**
   * Mimers Brunn CAS manifest digest (ADR-042). When set, the sealed promotion
   * is an index into Manifest → CAS → Ledger; content identity remains artifactHash.
   */
  readonly manifestHash?: string;
  readonly runtimeFingerprint?: string;
  readonly policySnapshotRef?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
  /** Set when schema migration cleared a prior signature. */
  readonly migrationNote?: string;

  /** AES envelope — content-addressed identity (= artifactHash). */
  readonly artifactId: string;
  readonly artifactHash: string;
  readonly signature?: string;
  readonly signingKeyId?: string;
}

export type PromotionSchemaVersion = PromotionArtifactV2['schemaVersion'] | PromotionArtifactV3['schemaVersion'];
