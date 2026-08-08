import { isAuthorityArtifactType } from "./authorityTypes.js";

/**
 * Soft write gate for the observation path.
 * GovernanceRuntime never exposes cas.put for authority types.
 */
export function assertObservationMayNotWrite(artifactType: string): void {
  if (isAuthorityArtifactType(artifactType)) {
    throw new Error(
      `REJECT_OBSERVATION_AUTHORITY: observation path cannot write artifact_type=${artifactType}`,
    );
  }
}

export type ObservationWriteIntent =
  | { readonly kind: "audit_session"; readonly artifact_type: "audit_session" }
  | { readonly kind: "proof_resolution"; readonly artifact_type: "proof_resolution" }
  | { readonly kind: "export_request"; readonly artifact_type: "export_request" };

const ALLOWED_OBSERVATION_WRITES = new Set([
  "audit_session",
  "proof_resolution",
  "export_request",
]);

export function assertAllowedObservationWrite(artifactType: string): void {
  assertObservationMayNotWrite(artifactType);
  if (!ALLOWED_OBSERVATION_WRITES.has(artifactType)) {
    throw new Error(
      `REJECT_OBSERVATION_WRITE: artifact_type=${artifactType} is not an allowed observation product`,
    );
  }
}
