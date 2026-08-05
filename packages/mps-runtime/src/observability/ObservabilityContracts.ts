/**
 * Runtime Observability contracts — Epoch II §2.8.
 *
 * Side channel / projection only — never a second source of truth.
 * Trace ids are content-hash derived (no wall-clock / random IDs).
 */

import type { ContentHash } from "../../../mps-compliance/src/artifacts/ContentHash.js";
import type { ArtifactReference } from "../../../mps-compliance/src/artifacts/ArtifactReference.js";

export const OBSERVABILITY_RUNTIME_VERSION = "1.0.0" as const;

export type ReplayLogRecord = {
  readonly kind: "replay_log";
  readonly equivalent: boolean;
  readonly prior_hash: string;
  readonly replayed_hash: string;
  readonly workflow_or_manifest_ref: ArtifactReference | null;
};

export type ExecutionGraphView = {
  readonly kind: "execution_graph";
  readonly nodes: readonly {
    readonly node_id: string;
    readonly node_kind: string;
    readonly artifact_id: string;
    readonly artifact_type: string;
  }[];
  readonly edges: readonly { readonly from: string; readonly to: string }[];
};

export type LineageEdge = {
  readonly from_artifact_id: string;
  readonly to_artifact_id: string;
  readonly relation:
    | "manifest_to_attempt"
    | "attempt_to_capability"
    | "attempt_to_outcome"
    | "workflow_to_capability"
    | "step_order";
};

export type LineageView = {
  readonly kind: "lineage";
  readonly edges: readonly LineageEdge[];
};

/** Deterministic tracing — ids from content hashes only. */
export type DeterministicTrace = {
  readonly kind: "trace";
  readonly trace_id: string;
  readonly span_ids: readonly string[];
};

export type ObservabilityBundle = {
  readonly kind: "observability_bundle";
  readonly version: typeof OBSERVABILITY_RUNTIME_VERSION;
  readonly trace: DeterministicTrace;
  readonly execution_graph: ExecutionGraphView;
  readonly lineage: LineageView;
  readonly replay_log: ReplayLogRecord | null;
  /** Fingerprint of the entire side-channel bundle. */
  readonly bundle_hash: ContentHash;
};
