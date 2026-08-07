import type { HarvestExecutionCheckpoint } from "./HarvestOrchestratorTypes";
import type { DatasetApprovalArtifact } from "./DatasetApprovalArtifact";
import type { ArtifactReference } from "../../mps-core/src/types";

export interface HarvestCheckpointStore {
  load(execution_id: string): Promise<HarvestExecutionCheckpoint | null>;
  save(execution_id: string, checkpoint: HarvestExecutionCheckpoint): Promise<void>;
  loadApproval(approval_ref: ArtifactReference): Promise<DatasetApprovalArtifact>;
}
