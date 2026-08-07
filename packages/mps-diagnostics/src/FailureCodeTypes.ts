/**
 * Package 22.3 — Failure code governance types.
 * Semantics only — no FailureArtifact creation.
 * @see ADR-MPS-022 §5 / F22-6
 */

export type FailureSeverity = "WARNING" | "ERROR" | "CRITICAL";

export type RetryPolicy = "NONE" | "AUTOMATIC" | "MANUAL";

export type FailureOwnership =
  | "INGESTION"
  | "GOVERNANCE"
  | "POLICY"
  | "INFRASTRUCTURE";

/**
 * Frozen meaning of a failure_code.
 * MUST NOT be duplicated into FailureArtifact identity (severity/retry/ownership live here).
 */
export interface FailureCodeDefinition {
  readonly code: string;
  readonly category: string;
  readonly severity: FailureSeverity;
  readonly retry_policy: RetryPolicy;
  readonly ownership: FailureOwnership;
  readonly remediation: string;
  readonly introduced_version: string;
  /** Optional short summary; does not enter FailureArtifact hash. */
  readonly summary?: string;
  /**
   * When set, code is deprecated — meaning is frozen; use successor_code for new semantics.
   * Deprecation does not change historical meaning of this code.
   */
  readonly deprecated?: boolean;
  readonly successor_code?: string;
}
