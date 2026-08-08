/**
 * Artifact types that observation MUST NEVER mint or cas.put.
 * GOVERNANCE-22.9-I13 — Observation Cannot Become Authority.
 */
export const AUTHORITY_ARTIFACT_TYPES = Object.freeze([
  "decision",
  "decision_impact",
  "approval",
  "policy",
  "capability_grant",
  "governance_rejection",
  "frozen_core_release_manifest",
  "execution_outcome",
  "runtime_admission",
] as const);

export type AuthorityArtifactType = (typeof AUTHORITY_ARTIFACT_TYPES)[number];

export function isAuthorityArtifactType(artifactType: string): boolean {
  return (AUTHORITY_ARTIFACT_TYPES as readonly string[]).includes(artifactType);
}
