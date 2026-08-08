/**
 * Build a deterministic retrieval set + trace from authorized plan + snapshot.
 * TRACE-I03: same query + policy + snapshot ⇒ same retrieval set / trace_hash.
 */

import type { RetrievalDecision } from "../../mps-retrieval-governance/src/index.js";
import { hashTraceCanonical } from "./canonicalTraceHash.js";
import {
  createRetrievalExecutionTrace,
  type RetrievalExecutionTraceArtifact,
  type RetrievalTraceMetadata,
} from "./RetrievalExecutionTrace.js";

export type RetrievalSetInput = {
  readonly intent: string;
  readonly authorized: RetrievalDecision;
  /** Content-addressed snapshot of DecisionImpact ids available for this query. */
  readonly artifact_snapshot: string;
  readonly selected_artifact_refs: readonly string[];
  readonly budget_profile: string;
  readonly metadata?: RetrievalTraceMetadata;
};

export type RetrievalSetResult = {
  readonly selected_artifact_refs: readonly string[];
  readonly trace: RetrievalExecutionTraceArtifact;
};

export function hashQuery(intent: string, policy_version: string): string {
  return hashTraceCanonical({ intent, policy_version });
}

/**
 * Observation-only retrieval set. Does not materialize or mutate DecisionImpact.
 */
export function buildRetrievalSet(input: RetrievalSetInput): RetrievalSetResult {
  const policy_version = input.authorized.policy.policy_version;
  const query_hash = hashQuery(input.intent, policy_version);

  const expansion_path: string[] = ["DecisionImpactArtifact"];
  if (input.authorized.expand_evidence) expansion_path.push("EvidenceReference");
  if (input.authorized.expand_raw) expansion_path.push("RawDocumentChunk");

  const selected = Object.freeze(
    [...input.selected_artifact_refs].sort(),
  ) as readonly string[];

  const trace = createRetrievalExecutionTrace(
    {
      query_hash,
      policy_version,
      artifact_snapshot: input.artifact_snapshot,
      selected_artifact_refs: selected,
      budget_profile: input.budget_profile,
      expansion_path,
    },
    input.metadata ?? {},
  );

  return Object.freeze({
    selected_artifact_refs: selected,
    trace,
  });
}
