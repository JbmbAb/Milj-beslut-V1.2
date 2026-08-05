import type { ArtifactReference } from "../../../mps-compliance/src/artifacts/ArtifactReference.js";

/** Deterministic retry policy (Execution Platform 2.1). */
export type RetryPolicy = {
  readonly max_attempts: number;
  /** Fixed delay between retries (ms). Deterministic — no jitter in v1. */
  readonly delay_ms: number;
  readonly retryable_reason_prefixes?: readonly string[];
};

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  max_attempts: 3,
  delay_ms: 0,
};

export type LeaseDecision =
  | { readonly action: "hold" }
  | { readonly action: "reclaim"; readonly reason: "lease_timeout" };

export type RetryDecision =
  | { readonly action: "retry"; readonly next_attempt: number }
  | { readonly action: "give_up"; readonly attempts: number; readonly reason: string };

export type ReplayScheduleJob = {
  readonly job_id: string;
  readonly manifest_ref: ArtifactReference;
  readonly attempt_ref: ArtifactReference | null;
  readonly scheduled_at: string;
  readonly status: "pending" | "leased" | "completed" | "failed";
};

export type CrashRecoveryReport = {
  readonly reclaimed_leases: number;
  readonly retried_failures: number;
  readonly replay_jobs_pending: number;
};

export type InfrastructureClock = {
  now(): Date;
};
