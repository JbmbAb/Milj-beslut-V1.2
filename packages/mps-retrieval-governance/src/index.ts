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
