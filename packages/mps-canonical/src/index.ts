// Endast publika interfaces exponeras enligt normativa regler.
export type { CanonicalRules } from "./CanonicalRules.js";
export { CANONICAL_RULES } from "./CanonicalRules.js";
export * from "./CanonicalTypes.js";
export type { CanonicalPipeline } from "./CanonicalPipeline.js";
export { DefaultCanonicalPipeline } from "./CanonicalPipeline.js";
export type { CanonicalArtifactFactory } from "./CanonicalArtifactFactory.js";
export { DefaultCanonicalArtifactFactory } from "./CanonicalArtifactFactory.js";
export type { CanonicalSerializer } from "./CanonicalSerializer.js";
export { DefaultCanonicalSerializer } from "./CanonicalSerializer.js";
// WORKSPACE-LIFECYCLE-CONTROLLER-V1: the JSON primitive is exposed under its own name because the
// frozen Phase 0 canonicalizer contract pins `DefaultCanonicalJson.toBytes` by name and by source
// SHA-256. Reaching it through DefaultCanonicalPipeline("JSON") is the same code path, but the pin
// is only auditable at the import site if the pinned class is the thing that gets imported.
export type { CanonicalJson } from "./CanonicalJson.js";
export { DefaultCanonicalJson } from "./CanonicalJson.js";
