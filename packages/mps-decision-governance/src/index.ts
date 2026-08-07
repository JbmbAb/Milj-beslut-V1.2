/**
 * @miljobeslut/mps-decision-governance — Decision Truth (constitutional layer)
 */

export {
  DECISION_GOVERNANCE_CANONICAL_VERSION,
  buildCanonicalLineageSlotPayload,
  buildDecisionImpactIdentityPayload,
  buildEvidenceSetIdentityPayload,
  deserializeCanonicalPayload,
  hashCanonicalLineageSlot,
  hashDecisionImpactIdentity,
  hashEvidenceSetIdentity,
  hashVersionedCanonicalPayload,
  serializeCanonicalPayload,
} from "./CanonicalDecisionImpactHash.js";

export type {
  DecisionImpactArtifact,
  DecisionImpactIdentity,
  DecisionImpactIndicator,
  DecisionImpactMetadata,
  DecisionType,
  IndicatorConfidence,
  IndicatorDerivation,
  JurisdictionLevel,
} from "./DecisionImpactIdentity.js";

export type {
  EvidenceDocumentReference,
  EvidenceSetArtifact,
  EvidenceSetIdentity,
  EvidenceSetLineageScope,
  EvidenceSetMetadata,
} from "./EvidenceSetArtifact.js";

export {
  EVIDENCE_SET_IDENTITY_FIELDS,
  EVIDENCE_SET_LINEAGE_SCOPE_FIELDS,
} from "./EvidenceSetArtifact.js";

export {
  InMemoryDecisionKnowledgeRepository,
  type DecisionKnowledgeRepository,
} from "./DecisionKnowledgeRepository.js";

export {
  assertAnalyticalRetrievalContract,
  createDecisionRetrievalPlan,
  DECISION_RETRIEVAL_CONTRACT_VERSION,
  DecisionRetrievalContractError,
  type AnalyticalQuery,
  type DecisionRetrievalPlan,
  type DecisionRetrievalResult,
  type RetrievalStage,
} from "./DecisionRetrievalContract.js";

export {
  EvidenceSetLineageError,
  InMemoryEvidenceSetLineageStore,
  LINEAGE_SLOT_UNIQUENESS,
  validateEvidenceSetLineage,
  type EvidenceSetLineageResolver,
} from "./validation/validateEvidenceSetLineage.js";
