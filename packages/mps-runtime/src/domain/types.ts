export type AttemptReason =
  | "INITIAL"
  | "RETRY"
  | "LEASE_RECOVERY";

export type ArtifactId = string;
export type AttemptId = string;
export type SnapshotId = string;

export interface CanonicalArtifact {
  readonly artifact_id: ArtifactId;
  readonly content_hash: string;
}

export interface ContentReference {
  readonly hash: string;
  readonly artifact_type: string;
}

export interface PlanArtifact extends CanonicalArtifact {
  readonly planner_input: unknown;
  readonly created_at: string;
}

export interface ExecutionAttempt {
  readonly attempt_id: AttemptId;

  /**
   * Always points to exactly one immutable PlanArtifact
   */
  readonly plan_id: ArtifactId;

  readonly runtime_snapshot_ref?: ContentReference;

  /**
   * Operational lineage only.
   * Never affects artifact identity.
   */
  readonly previous_attempt_id?: AttemptId;

  readonly reason: AttemptReason;

  readonly created_at: string;
}

export interface RuntimeTelemetry {
  readonly trace_id?: string;
  readonly span_id?: string;

  readonly started_at: string;
  readonly completed_at?: string;

  readonly duration_ms?: number;
}

export interface RuntimeResult<TArtifact extends CanonicalArtifact> {
  readonly artifact: TArtifact;
  readonly telemetry: RuntimeTelemetry;
}
