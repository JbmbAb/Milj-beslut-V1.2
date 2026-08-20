/**
 * LEGAL-RETRIEVAL-POLICY-01 — frozen policy shape for legal-corpus retrieval.
 *
 * Parallel to RetrievalPolicy.ts (LU domain), not an extension of it. See
 * LegalArtifactAccessRules.ts for why. `assertRetrievalReadOnly` from RetrievalDecision.ts IS
 * reused directly (not domain-specific: it only asserts the caller lacks materialization
 * authority) -- genuinely shared mechanics, not a generalized policy.
 */

import { assertRetrievalReadOnly } from "./RetrievalDecision.js";
import {
  getLegalAccessRule,
  LegalRetrievalGovernanceError,
  type LegalArtifactAccessRule,
  type LegalArtifactClass,
  type LegalQueryType,
} from "./LegalArtifactAccessRules.js";

export const LEGAL_RETRIEVAL_POLICY_VERSION = "legal-ret-policy-1" as const;

export const LEGAL_RET_I01 = "LEGAL-RET-I01" as const; // initial class must be LegalCorpusMaterializedChunk
export const LEGAL_RET_I02 = "LEGAL-RET-I02" as const; // artifact class isolation (legacy/unsigned forbidden)
export const LEGAL_RET_I03 = "LEGAL-RET-I03" as const; // retrieval is read-only, cannot create authority

export type LegalRetrievalPolicy = {
  readonly policy_version: string;
  readonly query_type: LegalQueryType;
  readonly access: LegalArtifactAccessRule;
  readonly read_only: true;
};

export function buildLegalRetrievalPolicy(
  query_type: LegalQueryType,
  policy_version: string = LEGAL_RETRIEVAL_POLICY_VERSION,
): LegalRetrievalPolicy {
  const access = getLegalAccessRule(query_type);

  if (access.initial !== "LegalCorpusMaterializedChunk") {
    throw new LegalRetrievalGovernanceError(
      "LEGAL_RET_I01_VIOLATION",
      `${LEGAL_RET_I01}: initial artifact MUST be LegalCorpusMaterializedChunk, got ${access.initial}`,
    );
  }

  return Object.freeze({
    policy_version,
    query_type,
    access,
    read_only: true,
  });
}

/** LEGAL-RET-I02: never permit a legacy or unsigned class through governed retrieval. */
export function assertLegalArtifactClassAllowed(
  policy: LegalRetrievalPolicy,
  artifact_class: LegalArtifactClass,
): void {
  if (policy.access.forbidden.includes(artifact_class)) {
    throw new LegalRetrievalGovernanceError(
      "LEGAL_RET_I02_VIOLATION",
      `${LEGAL_RET_I02}: artifact class ${artifact_class} forbidden for ${policy.query_type}`,
    );
  }
  if (!policy.access.allowed.includes(artifact_class)) {
    throw new LegalRetrievalGovernanceError(
      "LEGAL_RET_I02_VIOLATION",
      `${LEGAL_RET_I02}: artifact class ${artifact_class} not permitted for ${policy.query_type}`,
    );
  }
}

/** LEGAL-RET-I03: retrieval SHALL NOT write governed corpus authority. Reuses the LU domain's
 *  read-only assertion directly -- it is genuinely domain-agnostic (asserts the actor lacks
 *  materialization authority), not something specific to DecisionImpactArtifact. */
export function assertLegalRetrievalReadOnly(actor: string = "LegalRetrieval"): void {
  assertRetrievalReadOnly(actor);
}

/**
 * Produce a deterministic legal retrieval decision. Never writes CAS, never resolves to a
 * legacy or unsigned source.
 */
export function evaluateLegalRetrieval(query_type: LegalQueryType = "LEGAL_CORPUS_SEARCH"): {
  readonly policy: LegalRetrievalPolicy;
  readonly initial_artifact_class: "LegalCorpusMaterializedChunk";
  readonly read_only: true;
} {
  assertLegalRetrievalReadOnly("LegalRetrieval");
  const policy = buildLegalRetrievalPolicy(query_type);
  assertLegalArtifactClassAllowed(policy, "LegalCorpusMaterializedChunk");

  return Object.freeze({
    policy,
    initial_artifact_class: "LegalCorpusMaterializedChunk",
    read_only: true,
  });
}
