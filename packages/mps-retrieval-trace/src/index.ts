/**
 * @miljobeslut/mps-retrieval-trace
 * Retrieval Execution Trace — observation only (Commit F).
 */

export {
  canonicalizeTraceJson,
  hashTraceCanonical,
} from "./canonicalTraceHash.js";

export {
  RET_I05,
  TRACE_I03,
  RETRIEVAL_TRACE_CONTRACT_VERSION,
  TRACE_I01,
  TRACE_I02,
  assertTraceCannotCreateAuthority,
  buildTraceIdentityPayload,
  computeTraceHash,
  createRetrievalExecutionTrace,
  RetrievalTraceError,
  type RetrievalExecutionTraceArtifact,
  type RetrievalTraceIdentity,
  type RetrievalTraceMetadata,
} from "./RetrievalExecutionTrace.js";

export {
  buildRetrievalSet,
  hashQuery,
  type RetrievalSetInput,
  type RetrievalSetResult,
} from "./RetrievalSetBuilder.js";
