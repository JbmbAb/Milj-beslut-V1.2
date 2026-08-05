import type { ArtifactReference } from "../../../mps-compliance/src/artifacts/ArtifactReference.js";
import type { RetryPolicy } from "../../../mps-runtime/src/contracts/model/ExecutionPolicies.js";

export type { RetryPolicy };
export { DEFAULT_RETRY_POLICY } from "../../../mps-runtime/src/contracts/model/ExecutionPolicies.js";

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
