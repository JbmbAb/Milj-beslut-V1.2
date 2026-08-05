/**
 * Execution Contracts & Model — policies (what is allowed).
 * Epoch II §2.2 — domain-agnostic; no LU/domain imports.
 */

/** Deterministic retry — no jitter. Shared with Execution Infrastructure. */
export type RetryPolicy = {
  readonly max_attempts: number;
  /** Fixed delay between retries (ms). */
  readonly delay_ms: number;
  readonly retryable_reason_prefixes?: readonly string[];
};

export const DEFAULT_RETRY_POLICY: RetryPolicy = Object.freeze({
  max_attempts: 3,
  delay_ms: 0,
});

/**
 * Admission gate policy — who/what may be admitted.
 * `allow_bypass` MUST be false in production Execution Platform.
 */
export type AdmissionPolicy = {
  readonly policy_id: string;
  readonly require_verified_rules: boolean;
  readonly allow_bypass: boolean;
  readonly denied_reason_codes?: readonly string[];
};

export const DEFAULT_ADMISSION_POLICY: AdmissionPolicy = Object.freeze({
  policy_id: "admission.default.v1",
  require_verified_rules: true,
  allow_bypass: false,
});

/**
 * Cross-cutting execution constraints bound to a session / release.
 */
export type ExecutionPolicy = {
  readonly policy_id: string;
  readonly admission: AdmissionPolicy;
  readonly retry: RetryPolicy;
  readonly require_capability_resolution: boolean;
  readonly require_artifact_persistence: boolean;
  /** Lease timeout for durable tickets (ms). */
  readonly lease_timeout_ms: number;
};

export const DEFAULT_EXECUTION_POLICY: ExecutionPolicy = Object.freeze({
  policy_id: "execution.default.v1",
  admission: DEFAULT_ADMISSION_POLICY,
  retry: DEFAULT_RETRY_POLICY,
  require_capability_resolution: true,
  require_artifact_persistence: true,
  lease_timeout_ms: 5 * 60 * 1000,
});
