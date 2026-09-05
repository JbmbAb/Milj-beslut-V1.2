import type { ArtifactReference } from "../../../mps-compliance/src/artifacts/ArtifactReference.js";
import type {
  FrozenAdmissionResult,
  FrozenExecutionAttemptIdentity,
  FrozenExecutionManifestIdentity,
  FrozenWorkflowExecutionArtifact,
} from "../contracts/freeze/FrozenIdentities.js";

/**
 * Shared mutable surface for one execution. All kernel components read/write here.
 * Freeze: field *names* are stable; values evolve during a single run.
 */
export interface RegistrySnapshotView {
  readonly snapshot_id: string;
  readonly registry_hash: string;
}

export interface ExecutionGraphNode {
  readonly node_id: string;
  readonly kind: "capability" | "workflow_step" | "outcome";
  readonly ref: ArtifactReference;
}

export interface ExecutionGraph {
  readonly nodes: readonly ExecutionGraphNode[];
  readonly edges: readonly { readonly from: string; readonly to: string }[];
}

export interface WorkflowState {
  readonly workflow_definition_ref: ArtifactReference | null;
  readonly current_step_id: string | null;
  readonly completed_step_ids: readonly string[];
  readonly workflow_execution: FrozenWorkflowExecutionArtifact | null;
}

export interface RuntimeState {
  registry_snapshot: RegistrySnapshotView | null;
  admission: FrozenAdmissionResult | null;
  manifest: FrozenExecutionManifestIdentity | null;
  attempt: FrozenExecutionAttemptIdentity | null;
  execution_graph: ExecutionGraph;
  workflow_state: WorkflowState;
}

export function createEmptyRuntimeState(): RuntimeState {
  return {
    registry_snapshot: null,
    admission: null,
    manifest: null,
    attempt: null,
    execution_graph: { nodes: [], edges: [] },
    workflow_state: {
      workflow_definition_ref: null,
      current_step_id: null,
      completed_step_ids: [],
      workflow_execution: null,
    },
  };
}
