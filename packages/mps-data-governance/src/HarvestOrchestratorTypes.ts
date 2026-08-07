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
  readonly produced_artifacts: readonly ContentReference[];
  readonly evidence_refs: readonly ArtifactReference[];
}

/**
 * Runtime checkpoint — NOT a canonical artifact.
 * No content_hash, artifact_id, or signature fields.
 * This is operational state only, used for replay/resume.
 */
export interface HarvestExecutionCheckpoint {
  readonly checkpoint_version: number; // Ändrat från '1' till 'number' för att stödja framtida migrationer (Mimers Brunn v2.0.1)

  readonly execution_id: string;
  readonly state: HarvestExecutionState;

  readonly updated_at: Timestamp;

  readonly manifest_ref?: ContentReference;
  readonly verification_ref?: ContentReference;
  readonly approval_ref?: ContentReference;
  readonly gate_evidence_ref?: ContentReference;
  readonly projection_ref?: ContentReference;
  readonly lu_ref?: ContentReference;

  readonly compliance_results?: readonly ComplianceCheckResult[];
}
