export {
  buildLegalAnswerContext,
  DEFAULT_ANSWER_CONTEXT_POLICY,
  LEGAL_ANSWER_CONTEXT_CONTRACT_VERSION,
  LegalAnswerContextError,
  type LegalAnswerContextEntry,
  type LegalAnswerContextPolicy,
  type LegalAnswerContextV1,
  type RetrievalResultWithContent,
} from "./LegalAnswerContext.js";

export {
  buildCitation,
  LEGAL_ANSWER_CITATION_CONTRACT_VERSION,
  CitationError,
  type CitationRef,
  type ClaimedCitation,
} from "./Citation.js";

export {
  buildAnswerTrace,
  LEGAL_ANSWER_TRACE_CONTRACT_VERSION,
  type AnswerModelIdentity,
  type AnswerTraceArtifact,
  type AnswerTraceInput,
  type LegalAnswerMode,
} from "./AnswerTrace.js";

export {
  evaluateQuerySpecificity,
  QUERY_SPECIFICITY_GATE_VERSION,
  type QuerySpecificityResult,
  type QuerySpecificityVerdict,
} from "./QuerySpecificityGate.js";

export {
  evaluateNamedSourceConsistency,
  NAMED_SOURCE_CONSISTENCY_GATE_VERSION,
  type NamedSourceConsistencyInput,
  type NamedSourceConsistencyResult,
  type NamedSourceConsistencyVerdict,
} from "./NamedSourceConsistencyGate.js";
