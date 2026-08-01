import type { DashboardViewModel } from "./UiModels";

export interface UiState {
  readonly dashboard?: DashboardViewModel;
  readonly selectedPipelineId?: string;
  readonly selectedArtifactHash?: string;
  readonly selectedRegistrySnapshotId?: string;
  readonly selectedExecutionHash?: string;
  readonly selectedAuditRootHash?: string;
  readonly selectedSeedHash?: string;
  readonly selectedLineageRootHash?: string;
}

export type UiAction =
  | { type: "SELECT_PIPELINE"; pipelineId: string }
  | { type: "SELECT_ARTIFACT"; hash: string }
  | { type: "SELECT_REGISTRY"; snapshotId: string }
  | { type: "SELECT_EXECUTION"; executionHash: string }
  | { type: "SELECT_AUDIT_ROOT"; auditHash: string }
  | { type: "SELECT_SEED"; seedHash: string }
  | { type: "SELECT_LINEAGE_ROOT"; hash: string };

export function uiReducer(state: UiState, action: UiAction): UiState {
  switch (action.type) {
    case "SELECT_PIPELINE":
      return { ...state, selectedPipelineId: action.pipelineId };
    case "SELECT_ARTIFACT":
      return { ...state, selectedArtifactHash: action.hash };
    case "SELECT_REGISTRY":
      return { ...state, selectedRegistrySnapshotId: action.snapshotId };
    case "SELECT_EXECUTION":
      return { ...state, selectedExecutionHash: action.executionHash };
    case "SELECT_AUDIT_ROOT":
      return { ...state, selectedAuditRootHash: action.auditHash };
    case "SELECT_SEED":
      return { ...state, selectedSeedHash: action.seedHash };
    case "SELECT_LINEAGE_ROOT":
      return { ...state, selectedLineageRootHash: action.hash };
    default:
      return state;
  }
}
