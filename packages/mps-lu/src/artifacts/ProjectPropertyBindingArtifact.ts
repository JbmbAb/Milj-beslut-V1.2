import type { ArtifactContract, ArtifactReference } from "@miljobeslut/mps-compliance/src/artifacts/ArtifactContract";
import { sha256ContentHash } from "@miljobeslut/mps-compliance/src/canonical/sha256Canonical";
import type { ArtifactAttestation } from "@miljobeslut/mimers-brunn-core";

export const PROJECT_PROPERTY_BINDING_ARTIFACT_TYPE = "project_property_binding" as const;
export const PROJECT_PROPERTY_BINDING_CONTRACT_VERSION = "project-property-binding-v1" as const;

export interface ProjectPropertyBindingPayload {
  readonly project_id: string;
  readonly property_identity: string;
  readonly property_designation: string;
  readonly geometry_ref: ArtifactReference;
  readonly source_refs: readonly ArtifactReference[];
  readonly resolver_id: string;
  readonly resolver_version: string;
  readonly contract_version: typeof PROJECT_PROPERTY_BINDING_CONTRACT_VERSION;
}

export interface ProjectPropertyBindingArtifact extends ArtifactContract {
  readonly artifact_type: typeof PROJECT_PROPERTY_BINDING_ARTIFACT_TYPE;
  readonly payload: ProjectPropertyBindingPayload;
  readonly attestation?: ArtifactAttestation;
}

function required(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`REJECT_PROJECT_PROPERTY_BINDING: ${field} is required`);
  return normalized;
}

function reference(value: ArtifactReference, field: string): ArtifactReference {
  if (!value || typeof value !== "object") {
    throw new Error(`REJECT_PROJECT_PROPERTY_BINDING: ${field} is required`);
  }
  return {
    artifact_id: required(String(value.artifact_id ?? ""), `${field}.artifact_id`),
    artifact_type: required(String(value.artifact_type ?? ""), `${field}.artifact_type`),
  };
}

export function projectPropertyBindingIdentityPayload(
  payload: ProjectPropertyBindingPayload,
): ProjectPropertyBindingPayload {
  return {
    project_id: required(payload.project_id, "project_id"),
    property_identity: required(payload.property_identity, "property_identity"),
    property_designation: required(payload.property_designation, "property_designation"),
    geometry_ref: reference(payload.geometry_ref, "geometry_ref"),
    source_refs: payload.source_refs.map((item, index) => reference(item, `source_refs[${index}]`)),
    resolver_id: required(payload.resolver_id, "resolver_id"),
    resolver_version: required(payload.resolver_version, "resolver_version"),
    contract_version: PROJECT_PROPERTY_BINDING_CONTRACT_VERSION,
  };
}

export function createProjectPropertyBindingArtifact(
  payload: ProjectPropertyBindingPayload,
): ProjectPropertyBindingArtifact {
  const identity = projectPropertyBindingIdentityPayload(payload);
  const identityHash = sha256ContentHash({
    artifact_type: PROJECT_PROPERTY_BINDING_ARTIFACT_TYPE,
    canonicalizer_id: "rfc8785-sha256-v1",
    payload: identity,
  });
  const artifact: Omit<ProjectPropertyBindingArtifact, "content_hash"> = {
    artifact_id: `project-property-binding-${identityHash.value.slice(0, 24)}`,
    artifact_type: PROJECT_PROPERTY_BINDING_ARTIFACT_TYPE,
    references: [identity.geometry_ref, ...identity.source_refs],
    payload: identity,
  };
  return {
    ...artifact,
    content_hash: sha256ContentHash({
      artifact_type: artifact.artifact_type,
      artifact_id: artifact.artifact_id,
      references: artifact.references,
      payload: artifact.payload,
    }),
  };
}

/**
 * Structural validation: recomputes canonical identity/content_hash from the artifact's current
 * payload and rejects any mismatch. Without this, a caller could mutate a field the attestation
 * predicate does not echo (e.g. geometry_ref) while leaving content_hash stale, and signature
 * verification against that stale content_hash would still pass. Does NOT verify the attestation
 * signature itself -- see verifyProjectContextBindingArtifactAuthority for the full chain.
 */
export function validateProjectPropertyBindingArtifact(
  artifact: ProjectPropertyBindingArtifact,
): ProjectPropertyBindingArtifact {
  if (!artifact || typeof artifact !== "object" || artifact.artifact_type !== PROJECT_PROPERTY_BINDING_ARTIFACT_TYPE) {
    throw new Error("REJECT_PROJECT_PROPERTY_BINDING: artifact_type must be project_property_binding");
  }
  if (!artifact.payload || typeof artifact.payload !== "object") {
    throw new Error("REJECT_PROJECT_PROPERTY_BINDING: payload is required");
  }
  const rebuilt = createProjectPropertyBindingArtifact(artifact.payload);
  if (artifact.artifact_id !== rebuilt.artifact_id) {
    throw new Error("REJECT_PROJECT_PROPERTY_BINDING: artifact_id does not match canonical identity");
  }
  if (artifact.content_hash?.algorithm !== rebuilt.content_hash.algorithm || artifact.content_hash?.value !== rebuilt.content_hash.value) {
    throw new Error("REJECT_PROJECT_PROPERTY_BINDING: content_hash does not match canonical payload (tampered)");
  }
  return artifact;
}
