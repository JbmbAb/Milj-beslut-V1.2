/**
 * Observability Runtime — Epoch II §2.8.
 *
 * Collects replay logs · execution graph · lineage · deterministic traces
 * as a side channel. MUST NOT put / mutate CAS artifact identity.
 */

import type { ArtifactReference } from "../../../mps-compliance/src/artifacts/ArtifactReference.js";
import type { FrozenWorkflowExecutionArtifact } from "../contracts/freeze/FrozenIdentities.js";
import { sha256ContentHash } from "../kernel/ExecutionKernel.js";
import type { RuntimeState } from "../kernel/RuntimeState.js";
import type {
  DeterministicTrace,
  ExecutionGraphView,
  LineageEdge,
  LineageView,
  ObservabilityBundle,
  ReplayLogRecord,
} from "./ObservabilityContracts.js";
import { OBSERVABILITY_RUNTIME_VERSION } from "./ObservabilityContracts.js";

export type CollectFromRuntimeStateInput = {
  readonly state: RuntimeState;
  /** Optional outcome ref when not yet on graph (kernel outcome). */
  readonly outcome_ref?: ArtifactReference | null;
  readonly capability_execution_refs?: readonly ArtifactReference[];
};

export type CollectFromReplayInput = {
  readonly state: RuntimeState;
  readonly prior_hash: string;
  readonly replayed_hash: string;
  readonly equivalent: boolean;
  readonly workflow_or_manifest_ref?: ArtifactReference | null;
  readonly outcome_ref?: ArtifactReference | null;
  readonly capability_execution_refs?: readonly ArtifactReference[];
};

/**
 * Sole platform surface for Execution Platform observability side channel.
 */
export class ObservabilityRuntime {
  private constructor() {}

  static create(): ObservabilityRuntime {
    return new ObservabilityRuntime();
  }

  get version(): typeof OBSERVABILITY_RUNTIME_VERSION {
    return OBSERVABILITY_RUNTIME_VERSION;
  }

  collectFromRuntimeState(
    input: CollectFromRuntimeStateInput,
  ): ObservabilityBundle {
    return this.buildBundle({
      state: input.state,
      outcome_ref: input.outcome_ref ?? null,
      capability_execution_refs: input.capability_execution_refs ?? [],
      replay_log: null,
    });
  }

  collectFromReplay(input: CollectFromReplayInput): ObservabilityBundle {
    const replay_log: ReplayLogRecord = Object.freeze({
      kind: "replay_log" as const,
      equivalent: input.equivalent,
      prior_hash: input.prior_hash,
      replayed_hash: input.replayed_hash,
      workflow_or_manifest_ref: input.workflow_or_manifest_ref ?? null,
    });
    return this.buildBundle({
      state: input.state,
      outcome_ref: input.outcome_ref ?? null,
      capability_execution_refs: input.capability_execution_refs ?? [],
      replay_log,
    });
  }

  /**
   * Synthesize graph/lineage from a workflow execution artifact when
   * RuntimeState.execution_graph was not populated (common before kernel wiring).
   */
  collectFromWorkflowExecution(input: {
    readonly workflow_execution: FrozenWorkflowExecutionArtifact;
    readonly state?: RuntimeState | null;
  }): ObservabilityBundle {
    const wf = input.workflow_execution;
    const nodes = wf.execution_refs.map((ref, i) => ({
      node_id: `wf-step-${wf.execution_order[i] ?? i}`,
      node_kind: "workflow_step" as const,
      artifact_id: ref.artifact_id,
      artifact_type: ref.artifact_type,
    }));
    const edges = nodes.slice(1).map((node, i) => ({
      from: nodes[i]!.node_id,
      to: node.node_id,
    }));

    const execution_graph: ExecutionGraphView = Object.freeze({
      kind: "execution_graph" as const,
      nodes: Object.freeze(nodes),
      edges: Object.freeze(edges),
    });

    const lineage_edges: LineageEdge[] = [];
    lineage_edges.push({
      from_artifact_id: wf.workflow_definition_ref.artifact_id,
      to_artifact_id: wf.artifact_id,
      relation: "workflow_to_capability",
    });
    for (let i = 0; i < wf.execution_refs.length; i++) {
      const ref = wf.execution_refs[i]!;
      lineage_edges.push({
        from_artifact_id: wf.artifact_id,
        to_artifact_id: ref.artifact_id,
        relation: "workflow_to_capability",
      });
      if (i > 0) {
        lineage_edges.push({
          from_artifact_id: wf.execution_refs[i - 1]!.artifact_id,
          to_artifact_id: ref.artifact_id,
          relation: "step_order",
        });
      }
    }

    const lineage: LineageView = Object.freeze({
      kind: "lineage" as const,
      edges: Object.freeze(lineage_edges),
    });

    const trace = this.buildTrace({
      manifest_id: input.state?.manifest?.manifest_id ?? null,
      attempt_id: input.state?.attempt?.attempt_id ?? null,
      workflow_id: wf.artifact_id,
      graph_node_ids: nodes.map((n) => n.node_id),
      replay: null,
    });

    return this.finalizeBundle({
      trace,
      execution_graph,
      lineage,
      replay_log: null,
    });
  }

  private buildBundle(args: {
    readonly state: RuntimeState;
    readonly outcome_ref: ArtifactReference | null;
    readonly capability_execution_refs: readonly ArtifactReference[];
    readonly replay_log: ReplayLogRecord | null;
  }): ObservabilityBundle {
    const execution_graph = this.projectGraph(args.state);
    const lineage = this.buildLineage(args);
    const trace = this.buildTrace({
      manifest_id: args.state.manifest?.manifest_id ?? null,
      attempt_id: args.state.attempt?.attempt_id ?? null,
      workflow_id:
        args.state.workflow_state.workflow_execution?.artifact_id ?? null,
      graph_node_ids: execution_graph.nodes.map((n) => n.node_id),
      replay: args.replay_log,
    });

    return this.finalizeBundle({
      trace,
      execution_graph,
      lineage,
      replay_log: args.replay_log,
    });
  }

  private projectGraph(state: RuntimeState): ExecutionGraphView {
    const nodes = state.execution_graph.nodes.map((n) => ({
      node_id: n.node_id,
      node_kind: n.kind,
      artifact_id: n.ref.artifact_id,
      artifact_type: n.ref.artifact_type,
    }));
    return Object.freeze({
      kind: "execution_graph" as const,
      nodes: Object.freeze(nodes),
      edges: Object.freeze(
        state.execution_graph.edges.map((e) =>
          Object.freeze({ from: e.from, to: e.to }),
        ),
      ),
    });
  }

  private buildLineage(args: {
    readonly state: RuntimeState;
    readonly outcome_ref: ArtifactReference | null;
    readonly capability_execution_refs: readonly ArtifactReference[];
  }): LineageView {
    const edges: LineageEdge[] = [];
    const manifest = args.state.manifest;
    const attempt = args.state.attempt;

    if (manifest && attempt) {
      edges.push({
        from_artifact_id: manifest.manifest_id,
        to_artifact_id: attempt.attempt_id,
        relation: "manifest_to_attempt",
      });
    }

    for (const cap of args.capability_execution_refs) {
      if (attempt) {
        edges.push({
          from_artifact_id: attempt.attempt_id,
          to_artifact_id: cap.artifact_id,
          relation: "attempt_to_capability",
        });
      }
    }

    for (const node of args.state.execution_graph.nodes) {
      if (node.kind === "capability" && attempt) {
        const already = edges.some(
          (e) =>
            e.relation === "attempt_to_capability" &&
            e.to_artifact_id === node.ref.artifact_id,
        );
        if (!already) {
          edges.push({
            from_artifact_id: attempt.attempt_id,
            to_artifact_id: node.ref.artifact_id,
            relation: "attempt_to_capability",
          });
        }
      }
    }

    if (attempt && args.outcome_ref) {
      edges.push({
        from_artifact_id: attempt.attempt_id,
        to_artifact_id: args.outcome_ref.artifact_id,
        relation: "attempt_to_outcome",
      });
    }

    return Object.freeze({
      kind: "lineage" as const,
      edges: Object.freeze(edges),
    });
  }

  private buildTrace(args: {
    readonly manifest_id: string | null;
    readonly attempt_id: string | null;
    readonly workflow_id: string | null;
    readonly graph_node_ids: readonly string[];
    readonly replay: ReplayLogRecord | null;
  }): DeterministicTrace {
    const tracePayload = {
      manifest_id: args.manifest_id,
      attempt_id: args.attempt_id,
      workflow_id: args.workflow_id,
      replay_prior: args.replay?.prior_hash ?? null,
      replay_replayed: args.replay?.replayed_hash ?? null,
    };
    const trace_id = sha256ContentHash(tracePayload).value;

    const span_ids = args.graph_node_ids.map(
      (node_id) =>
        sha256ContentHash({ trace_id, span: node_id }).value.slice(0, 16),
    );

    return Object.freeze({
      kind: "trace" as const,
      trace_id,
      span_ids: Object.freeze(span_ids),
    });
  }

  private finalizeBundle(parts: {
    readonly trace: DeterministicTrace;
    readonly execution_graph: ExecutionGraphView;
    readonly lineage: LineageView;
    readonly replay_log: ReplayLogRecord | null;
  }): ObservabilityBundle {
    const canonical = {
      version: OBSERVABILITY_RUNTIME_VERSION,
      trace: parts.trace,
      execution_graph: parts.execution_graph,
      lineage: parts.lineage,
      replay_log: parts.replay_log,
    };
    return Object.freeze({
      kind: "observability_bundle" as const,
      version: OBSERVABILITY_RUNTIME_VERSION,
      trace: parts.trace,
      execution_graph: parts.execution_graph,
      lineage: parts.lineage,
      replay_log: parts.replay_log,
      bundle_hash: sha256ContentHash(canonical),
    });
  }
}
