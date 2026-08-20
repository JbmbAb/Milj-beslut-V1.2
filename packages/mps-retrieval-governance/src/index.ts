/**
 * @miljobeslut/mps-retrieval-governance
 * Policy boundary: what intelligence may use. Read-only. No authority creation.
 */

export {
  ARTIFACT_ACCESS_RULES,
  getAccessRule,
  RetrievalGovernanceError,
  type ArtifactAccessRule,
  type ArtifactClass,
  type QueryType,
} from "./ArtifactAccessRules.js";

export {
  assertArtifactClassAllowed,
  buildRetrievalPolicy,
  classifyQuery,
  MIMER_RET_I01,
  MIMER_RET_I02,
  MIMER_RET_I03,
  MIMER_RET_I04,
  MIMER_RET_I05,
  MIMER_RET_I06,
  RETRIEVAL_POLICY_VERSION,
  type ClassifiedQuery,
  type RetrievalPolicy,
} from "./RetrievalPolicy.js";

export {
  createRetrievalPolicyRegistry,
  defaultRetrievalPolicyRegistry,
  type RetrievalPolicyRegistration,
  type RetrievalPolicyRegistry,
} from "./RetrievalPolicyRegistry.js";

export {
  assertRetrievalReadOnly,
  evaluateRetrieval,
  type RetrievalDecision,
  type RetrievalRequest,
} from "./RetrievalDecision.js";

// LEGAL-RETRIEVAL-POLICY-01 — parallel to the LU exports above, not an extension of them.
export {
  getLegalAccessRule,
  LEGAL_ARTIFACT_ACCESS_RULES,
  LegalRetrievalGovernanceError,
  type LegalArtifactAccessRule,
  type LegalArtifactClass,
  type LegalQueryType,
} from "./LegalArtifactAccessRules.js";

export {
  assertLegalArtifactClassAllowed,
  assertLegalRetrievalReadOnly,
  buildLegalRetrievalPolicy,
  evaluateLegalRetrieval,
  LEGAL_RET_I01,
  LEGAL_RET_I02,
  LEGAL_RET_I03,
  LEGAL_RETRIEVAL_POLICY_VERSION,
  type LegalRetrievalPolicy,
} from "./LegalRetrievalPolicy.js";
