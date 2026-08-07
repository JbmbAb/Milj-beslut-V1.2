// packages/mps-data-governance/src/HarvestOrchestratorTypes.ts

import type {
  ContentReference,
  ArtifactReference,
  Timestamp,
} from "../../mps-core/src/types";
import type { ComplianceCheckResult } from "./ImportGateTypes";

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

export interface HarvestExecutionRequest {
  readonly dataset_ref: ContentReference;
  readonly execution_id: string;
  readonly requested_at: Timestamp;
}

export interface HarvestExecutionResult {
  readonly state: HarvestExecutionState;
  /**
   * A run yields both harvested content, which carries no authority, and
   * governed artifacts, which do. Both are "produced", so the union is the
   * honest type; use `evidence_refs` when only decisions matter.
   */
  readonly produced_artifacts: readonly (ContentReference | ArtifactReference)[];
  readonly evidence_refs: readonly ArtifactReference[];
}

/**
 * Runtime checkpoint — NOT a canonical artifact.
 * No content_hash, artifact_id, or signature fields.
 * This is operational state only, used for replay/resume.
 */
export interface HarvestExecutionCheckpoint {
  readonly checkpoint_version: 1;

  readonly execution_id: string;
  readonly state: HarvestExecutionState;

  /**
   * Non-canonical runtime timestamp.
   * SHALL NOT participate in hashing, signing,
   * artifact identity, or replay equality.
   */
  readonly updated_at: Timestamp;

  readonly manifest_ref?: ContentReference;
  readonly archive_refs?: readonly ContentReference[];

  readonly verification_ref?: ArtifactReference;
  readonly approval_ref?: ArtifactReference;
  readonly gate_evidence_ref?: ArtifactReference;
  readonly projection_ref?: ArtifactReference;
  readonly lu_ref?: ArtifactReference;

  readonly compliance_results?: readonly ComplianceCheckResult[];
}
