/**
 * Package 22.1 — Diagnostic stage / harvest state mirrors (observe-only).
 * HarvestExecutionState MUST stay aligned with Package 21 types.
 * @see docs/architecture/ADR-MPS-022-Diagnostic-Governance-Layer.md
 */

export type ExecutionStage =
  | "HARVEST"
  | "VERIFY"
  | "COMPLIANCE"
  | "IMPORT_GATE"
  | "PROJECTION"
  | "LU";

/** Mirror of Package 21 HarvestExecutionState — observe only, never mutates P21. */
export type HarvestExecutionState =
  | "CREATED"
  | "HARVESTING"
  | "HARVESTED"
  | "VERIFYING"
  | "QUARANTINED"
  | "VERIFIED"
  | "AWAITING_APPROVAL"
  | "APPROVED"
  | "ARCHIVED"
  | "COMPLIANCE_CHECK"
  | "BLOCKED"
  | "IMPORT_GATE"
  | "ALLOW_IMPORT"
  | "POSTGIS_PROJECTION"
  | "READY_FOR_LU";

export type Timestamp = string;

export interface DiagnosticContentReference {
  readonly id: string;
  readonly content_hash: {
    readonly algorithm: string;
    readonly digest: string;
  };
}

export interface DiagnosticArtifactReference {
  readonly artifact_id: string;
  readonly content_hash?: {
    readonly algorithm: string;
    readonly digest: string;
  };
}
