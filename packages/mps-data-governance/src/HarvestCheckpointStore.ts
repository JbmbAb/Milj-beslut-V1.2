// packages/mps-data-governance/src/HarvestCheckpointStore.ts

import type { HarvestExecutionCheckpoint } from "./HarvestOrchestratorTypes";
import type { DatasetApprovalArtifact } from "./DatasetApprovalArtifact";
import type { ArtifactReference } from "../../mps-core/src/types";

/**
 * Runtime-only persistence of execution checkpoints.
 * Checkpoints are NOT canonical artifacts.
 */
export interface HarvestCheckpointStore {
  load(execution_id: string): Promise<HarvestExecutionCheckpoint | null>;

  save(
    execution_id: string,
    checkpoint: HarvestExecutionCheckpoint
  ): Promise<void>;

  remove(execution_id: string): Promise<void>;

  loadApproval(approval_ref: ArtifactReference): Promise<DatasetApprovalArtifact>;
}
