/**
 * MAT-I02 — Materialization SHALL NOT calculate identity directly.
 *
 * Identity authority lives in mps-decision-governance. The pipeline receives it
 * through this port, so it can never grow its own hashing.
 */

import {
  DECISION_GOVERNANCE_CANONICAL_VERSION,
  hashDecisionImpactIdentity,
  hashEvidenceSetIdentity,
  hashVersionedCanonicalPayload,
  serializeCanonicalPayload,
  type DecisionImpactIdentity,
  type EvidenceSetIdentity,
} from "../../../mps-decision-governance/src/index.js";

export interface MaterializationIdentityProvider {
  readonly canonical_version: string;
  hashFacts(payload: unknown): string;
  hashEvidenceSet(identity: EvidenceSetIdentity): string;
  hashDecisionImpact(identity: DecisionImpactIdentity): string;
  canonicalPayload(payload: unknown): string;
}

export const decisionGovernanceIdentityProvider: MaterializationIdentityProvider = Object.freeze({
  canonical_version: DECISION_GOVERNANCE_CANONICAL_VERSION,
  hashFacts: (payload: unknown) => hashVersionedCanonicalPayload(payload),
  hashEvidenceSet: (identity: EvidenceSetIdentity) => hashEvidenceSetIdentity(identity),
  hashDecisionImpact: (identity: DecisionImpactIdentity) => hashDecisionImpactIdentity(identity),
  canonicalPayload: (payload: unknown) => serializeCanonicalPayload(payload),
});
