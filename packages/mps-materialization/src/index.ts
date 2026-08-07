/**
 * @miljobeslut/mps-materialization
 * Deterministic Decision Truth Engine — constitutional projection, no LLM.
 */

export {
  assertNoAiInMaterializationCore,
  MATERIALIZATION_VERSION,
  MaterializationContractError,
  RULE_VERSION,
  type MaterializationContract,
  type MaterializationResult,
  type MaterializationVersions,
  type VerifiedEvidenceSet,
} from "./MaterializationContract.js";

export {
  createSetEvidenceResolver,
  preVerifiedEvidenceResolver,
  type EvidenceResolver,
} from "./ports/EvidenceResolver.js";

export {
  decisionGovernanceIdentityProvider,
  type MaterializationIdentityProvider,
} from "./ports/MaterializationIdentityProvider.js";

export {
  assertMaterializationAuthority,
  MATERIALIZATION_AUTHORITY_CREATORS,
  MATERIALIZATION_AUTHORITY_FORBIDDEN,
  MaterializationAuthorityError,
  MIMER_MAT_I01,
  type AuthorityActor,
} from "./MaterializationAuthority.js";

export {
  createMaterializationRegistry,
  DECISION_IMPACT_V1,
  defaultMaterializationRegistry,
  type MaterializationArtifactType,
  type MaterializationRegistration,
  type MaterializationRegistry,
} from "./MaterializationRegistry.js";

export { buildDecisionFacts, type DecisionFacts } from "./DecisionFactsBuilder.js";

export {
  buildDecisionImpactFromFacts,
  buildEvidenceSetFromFacts,
  type BuiltImpact,
} from "./DecisionImpactBuilder.js";

export { LineageValidator, EvidenceSetLineageError } from "./LineageValidator.js";

export {
  CasMaterializationRepository,
  type MaterializationRepository,
} from "./MaterializationRepository.js";

export {
  MaterializationPipeline,
  type MaterializationPipelineOptions,
} from "./MaterializationPipeline.js";
