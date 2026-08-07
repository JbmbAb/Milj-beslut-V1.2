import type { ContentReference, ArtifactReference } from "../../mps-core/src/types";

export type HarvestExecutionState =
  | "CREATED"
  | "HARVESTED"
  | "VERIFIED"
  | "AWAITING_APPROVAL"
  | "APPROVED"
  | "COMPLIANCE_CHECK"
  | "ALLOW_IMPORT"
  | "POSTGIS_PROJECTION"
  | "READY_FOR_LU"
  | "QUARANTINED"
  | "BLOCKED"
  | "ARCHIVED";

export interface HarvestExecutionRequest {
  readonly execution_id: string;
  readonly source_id: string;
  readonly requested_at: string;
}

export interface HarvestExecutionCheckpoint {
  readonly state: HarvestExecutionState;
  readonly manifest_ref?: ContentReference;
  readonly verification_ref?: ContentReference;
  readonly approval_ref?: ContentReference;
  readonly compliance_results?: readonly any[];
  readonly gate_evidence_ref?: ContentReference;
  readonly archive_refs?: readonly ContentReference[];
  readonly projection_ref?: ContentReference;
  readonly lu_ref?: ContentReference;
}

export interface HarvestExecutionResult {
  readonly state: HarvestExecutionState;
  readonly produced_artifacts: readonly ContentReference[];
  readonly evidence_refs: readonly ArtifactReference[];
}
