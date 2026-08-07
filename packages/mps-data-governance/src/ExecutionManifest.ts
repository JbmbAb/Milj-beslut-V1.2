// packages/mps-data-governance/src/ExecutionManifest.ts

import type { HarvestExecutionCheckpoint, HarvestExecutionState } from "./HarvestOrchestratorTypes";
import type { ContentReference, ArtifactReference, Timestamp } from "../../mps-core/src/types";

export interface ExecutionManifest {
  readonly checkpoint_version: number;
  readonly execution_id: string;
  readonly state: HarvestExecutionState;
  readonly updated_at: Timestamp;
  readonly dataset_ref: ContentReference;
  readonly requested_at: Timestamp;

  readonly manifest_ref?: ContentReference;
  readonly archive_refs?: readonly ContentReference[];

  readonly verification_ref?: ArtifactReference;
  readonly approval_ref?: ArtifactReference;
  readonly gate_evidence_ref?: ArtifactReference;
  readonly projection_ref?: ArtifactReference;
  readonly lu_ref?: ArtifactReference;

  readonly compliance_results?: readonly any[];
}

/**
 * Projicerar en tillfällig körtids-checkpoint till ett oföränderligt
 * och sammanställt exekverings-manifest (ExecutionManifest) lämpligt för replay.
 * 
 * Inga tidsstämplar genereras, ingen mutation sker (ren projektion).
 */
export function buildExecutionManifest(
  checkpoint: HarvestExecutionCheckpoint,
  dataset_ref: ContentReference,
  requested_at: Timestamp
): ExecutionManifest {
  return {
    checkpoint_version: checkpoint.checkpoint_version,
    execution_id: checkpoint.execution_id,
    state: checkpoint.state,
    updated_at: checkpoint.updated_at,
    dataset_ref,
    requested_at,
    manifest_ref: checkpoint.manifest_ref,
    archive_refs: checkpoint.archive_refs,
    verification_ref: checkpoint.verification_ref,
    approval_ref: checkpoint.approval_ref,
    gate_evidence_ref: checkpoint.gate_evidence_ref,
    projection_ref: checkpoint.projection_ref,
    lu_ref: checkpoint.lu_ref,
    compliance_results: checkpoint.compliance_results
  };
}
