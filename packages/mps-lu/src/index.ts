// Domain
export * from "./domain/AssessmentFinding";
export * from "./domain/CanonicalGeometry";
export * from "./domain/RelevantDocument";

// Artifacts
export * from "./artifacts/DocumentEvidenceArtifact";
export * from "./artifacts/LocalizationAssessmentArtifact";
export * from "./artifacts/SpatialEvidenceArtifact";
export * from "./artifacts/SpatialEvidenceIdentity";
export * from "./artifacts/SpatialResultSemantics";
export * from "./artifacts/SpatialEngineFingerprint";
export * from "./artifacts/LUProjectContextArtifact";
export * from "./artifacts/LUPropertyContextArtifact";
export * from "./artifacts/ProjectContextBindingArtifact";
export * from "./artifacts/ProjectContextBindingSupersessionArtifact";
export * from "./artifacts/ProjectContextBindingSupersessionGraph";
export * from "./artifacts/ProjectPropertyBindingArtifact";
export * from "./artifacts/ProjectContextBindingIssuerArtifact";
export * from "./artifacts/ProjectContextBindingSupersessionIssuerArtifact";
export * from "./artifacts/LuExecutionAuthorityArtifact";
export * from "./execution/LuExecutionAuthorityChain";
export * from "./execution/LuExecutionIdentitySeed";
export * from "./artifacts/ProductLuContextArtifacts";
export * from "./artifacts/LocalizationGeometryArtifact";
export * from "./artifacts/LocalizationGeometrySupersessionArtifact";
export * from "./artifacts/LocalizationGeometrySupersessionGraph";
export * from "./artifacts/CanonicalPropertyArtifacts";
export * from "./artifacts/ProductViewerCapabilityArtifact";
export * from "./artifacts/ViewerIdentityArtifact";
export * from "./governance/GovernedAssessmentPersistence";
export * from "./governance/LuExecutionAuthorityLifecycle";
export * from "./governance/LuSourceAuthorityEvidence";
export * from "./governance/LuSourceAuthorityTemporalStatus";
export * from "./governance/LuSourceAuthorityWiring";
export * from "./viewer/ViewerKernel";

// Services
export * from "./services/SpatialQueryContract";
export * from "./services/LUProjectContextService";

// Providers
export * from "./providers/SpatialProviderResolver";
export * from "./providers/DocumentProviderContract";
export * from "./providers/NullDocumentProvider";

// Rules: LURuleEngine is deliberately NOT exported (LU-CANONICAL-RUNTIME-HARDENING-R1). It is an
// internal implementation detail reached only through the governed kernel client; internal
// modules and tests import it by explicit path (`./rules/LURuleEngine`).

// Canonical LU product execution entrypoint.
// LU-CANONICAL-PATH-01: the general/legacy-capable runLuAssessmentViaKernel remains an internal
// engine for tests/ops and is intentionally NOT exported through the package root. Product code
// importing @miljobeslut/mps-lu can only enter assessment execution through the V3-scoped
// canonical wrapper.
export { runCanonicalLuProductAssessment } from "./execution/LuExecutionKernelClient";
export type { CanonicalLuKernelRunInput, LuKernelRunResult } from "./execution/LuExecutionKernelClient";
export { LU_EXECUTION_PRINCIPAL_ID } from "./execution/LuExecutionPrincipal";
export * from "./execution/LuDeterministicReExecution";
export * from "./registry/LuSiteAssessmentRegistry";
export * from "./registry/createLuRegistryRuntime";

// PROD-LU-ADMISSION-02 — explicit execution-identity provisioning (issuer side).
// Deliberately exported: whoever provisions a run ahead of time is expected to be external to
// this package (a composition-root/operator step, or a test acting as that step).
export * from "./execution/LuExecutionIdentityIssuer";
export * from "./execution/LuCanonicalServiceIdentity";

// LU Runtime v1 Freeze (ADR-30)
export * from "./runtime/LuRuntimeFreeze";

// API
export * from "./api/LUBackendOrchestrator";
