/**
 * RetrievalDecision — evaluate a query against policy (deterministic, read-only).
 *
 * Order:
 *   Query → Classification → Retrieval Policy → Allowed Artifact Classes
 *        → Expansion Policy → (Budget later) → Execution
 *
 * MIMER-RET-I01 Decision First
 * MIMER-RET-I02 Artifact Class Isolation
 * MIMER-RET-I03 Retrieval Cannot Create Authority
 */

import {
  assertMaterializationAuthority,
  MaterializationAuthorityError,
} from "../../mps-materialization/src/MaterializationAuthority.js";
import type { ArtifactClass } from "./ArtifactAccessRules.js";
import { RetrievalGovernanceError } from "./ArtifactAccessRules.js";
import {
  assertArtifactClassAllowed,
  classifyQuery,
  MIMER_RET_I01,
  MIMER_RET_I03,
  type RetrievalPolicy,
} from "./RetrievalPolicy.js";
import {
  defaultRetrievalPolicyRegistry,
  type RetrievalPolicyRegistry,
} from "./RetrievalPolicyRegistry.js";

export type RetrievalRequest = {
  readonly intent: string;
  /** Requested initial class — MUST be DecisionImpactArtifact for general analytical use. */
  readonly requested_initial?: ArtifactClass;
  readonly expand_evidence?: boolean;
  readonly expand_raw?: boolean;
};

export type RetrievalDecision = {
  readonly policy: RetrievalPolicy;
  readonly initial_artifact_class: "DecisionImpactArtifact";
  readonly expand_evidence: boolean;
  readonly expand_raw: boolean;
  readonly read_only: true;
  readonly denied_reasons: readonly string[];
};

/**
 * MIMER-RET-I03: Retrieval SHALL NOT write Decision Truth.
 * Any attempt to use retrieval as a write actor MUST fail.
 */
export function assertRetrievalReadOnly(actor: string = "Retrieval"): void {
  try {
    assertMaterializationAuthority(actor);
    throw new RetrievalGovernanceError(
      "MIMER_RET_I03_VIOLATION",
      `${MIMER_RET_I03}: unexpected — actor '${actor}' passed materialization authority`,
    );
  } catch (err) {
    if (err instanceof MaterializationAuthorityError) {
      return; // expected: retrieval cannot create authority
    }
    throw err;
  }
}

/**
 * Produce a deterministic retrieval decision. Never writes CAS.
 */
export function evaluateRetrieval(
  request: RetrievalRequest,
  registry: RetrievalPolicyRegistry = defaultRetrievalPolicyRegistry,
): RetrievalDecision {
  assertRetrievalReadOnly("Retrieval");

  const classified = classifyQuery(request.intent);
  const policy = registry.resolve(classified.query_type);

  const requested = request.requested_initial ?? "DecisionImpactArtifact";
  if (requested !== "DecisionImpactArtifact") {
    throw new RetrievalGovernanceError(
      "MIMER_RET_I01_VIOLATION",
      `${MIMER_RET_I01}: General queries SHALL resolve through DecisionImpactArtifact first; got ${requested}`,
    );
  }

  assertArtifactClassAllowed(policy, "DecisionImpactArtifact");

  const denied: string[] = [];
  let expand_evidence = Boolean(request.expand_evidence);
  let expand_raw = Boolean(request.expand_raw);

  if (expand_evidence && !policy.allow_evidence_expansion) {
    denied.push("evidence_expansion_denied_by_policy");
    expand_evidence = false;
  }
  if (expand_raw && !policy.allow_raw_expansion) {
    denied.push("raw_expansion_denied_by_policy");
    expand_raw = false;
  }

  // Never allow raw without evidence path when both requested (constitutional order).
  if (expand_raw && !expand_evidence && !policy.access.allowed.includes("RawDocumentChunk")) {
    // PROVENANCE_AUDIT allows raw in allowed list — still requires DecisionImpact first.
    if (!policy.allow_raw_expansion) {
      expand_raw = false;
      denied.push("raw_without_decision_first");
    }
  }

  if (expand_raw) {
    assertArtifactClassAllowed(policy, "RawDocumentChunk");
  }
  if (expand_evidence) {
    const evidenceClass: ArtifactClass = policy.access.allowed.includes("EvidenceSet")
      ? "EvidenceSet"
      : "EvidenceReference";
    assertArtifactClassAllowed(policy, evidenceClass);
  }

  return Object.freeze({
    policy,
    initial_artifact_class: "DecisionImpactArtifact",
    expand_evidence,
    expand_raw,
    read_only: true,
    denied_reasons: Object.freeze(denied),
  });
}
