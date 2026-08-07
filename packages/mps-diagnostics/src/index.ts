/**
 * @miljobeslut/mps-diagnostics — Package 22 Diagnostic Governance Layer
 * ADR-MPS-022 (FROZEN rev 022.1)
 *
 * 22.1: ExecutionEvent + ExecutionEventLog
 * 22.2: FailureArtifact (+ BLOCKED binding)
 * 22.3: FailureCodeRegistry (governed failure semantics)
 * 22.4: CorrelationContext (navigation / observability)
 * 22.5: ReplayDifferential (later — blocked until registries stable)
 */

export type {
  DiagnosticArtifactReference,
  DiagnosticContentReference,
  ExecutionStage,
  HarvestExecutionState,
  Timestamp,
} from "./types.js";

export {
  buildTransitionIdentityPayload,
  computeTransitionHash,
  createExecutionEvent,
  verifyExecutionEventIntegrity,
  type ExecutionEvent,
  type ExecutionEventIdentity,
  type ExecutionEventInput,
  type ExecutionEventMetadata,
} from "./ExecutionEvent.js";

export {
  ExecutionEventLogError,
  InMemoryExecutionEventLog,
  type AppendTransitionInput,
  type ExecutionEventLog,
} from "./ExecutionEventLog.js";

export {
  assertBlockedFailureArtifactRequired,
  createFailureArtifact,
  FailureArtifactError,
  failureRefAsOutputArtifact,
  toFailureArtifactReference,
  verifyFailureArtifactIntegrity,
  type FailureArtifact,
  type FailureArtifactIdentity,
  type FailureArtifactInput,
  type FailureArtifactMetadata,
  type FailureArtifactReference,
} from "./FailureArtifact.js";

export { FailureArtifactBuilder } from "./FailureArtifactBuilder.js";

export {
  buildFailureIdentityPayload,
  canonicalFailureIdentity,
  computeFailureArtifactHash,
  sanitizeDiagnostics,
  type FailureIdentityPayload,
} from "./canonicalFailureIdentity.js";

export type {
  FailureCodeDefinition,
  FailureOwnership,
  FailureSeverity,
  RetryPolicy,
} from "./FailureCodeTypes.js";

export {
  createFailureCodeRegistry,
  defaultFailureCodeRegistry,
  FAILURE_CODE_DEFINITIONS_V1,
  FAILURE_CODE_REGISTRY_VERSION,
  FailureCodeRegistryError,
  type FailureCodeRegistry,
} from "./FailureCodeRegistry.js";

export {
  CORRELATION_NON_IDENTITY_KEYS,
  CorrelationError,
  createCorrelationContext,
  type CorrelationContext,
  type CorrelationLink,
} from "./CorrelationContext.js";

export {
  InMemoryCorrelationResolver,
  type CorrelationResolver,
} from "./CorrelationResolver.js";

export { canonicalizeJson, hashCanonical } from "./canonicalHash.js";
