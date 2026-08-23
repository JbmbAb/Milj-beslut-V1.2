import type { ArtifactReference } from "@miljobeslut/mps-compliance/src/artifacts/ArtifactContract";
import { sha256ContentHash } from "@miljobeslut/mps-compliance/src/canonical/sha256Canonical";
import type { LUProjectContextArtifact } from "./LUProjectContextArtifact";
import type { LUPropertyContextArtifact } from "./LUPropertyContextArtifact";

export const PRODUCT_LU_CONTEXT_CONTRACT_VERSION = "product-lu-context-v1" as const;

function contextArtifact<T extends { artifact_type: string; references: readonly ArtifactReference[]; payload: object }>(
  artifactType: T["artifact_type"],
  references: readonly ArtifactReference[],
  payload: T["payload"],
): T {
  const identityHash = sha256ContentHash({
    canonicalizer_id: "rfc8785-sha256-v1",
    artifact_type: artifactType,
    contract_version: PRODUCT_LU_CONTEXT_CONTRACT_VERSION,
    payload,
  });
  const artifact = {
    artifact_id: `${artifactType.toLowerCase()}-${identityHash.value.slice(0, 24)}`,
    artifact_type: artifactType,
    references,
    payload,
  } as Omit<T, "content_hash">;
  return {
    ...artifact,
    content_hash: sha256ContentHash(artifact),
  } as T;
}

export function createProductLuPropertyContextArtifact(input: {
  readonly property_identity: string;
  readonly property_ref: string;
  readonly official_name: string;
  readonly geometry_ref: ArtifactReference;
  readonly municipality: string;
  readonly coordinates: readonly [number, number];
  readonly project_property_binding_ref: ArtifactReference;
}): LUPropertyContextArtifact {
  if (!input.property_identity.trim() || !input.project_property_binding_ref?.artifact_id) {
    throw new Error("REJECT_PRODUCT_LU_PROPERTY_CONTEXT: canonical property and binding references are required");
  }
  const payload = {
    property_ref: input.property_ref,
    official_name: input.official_name,
    geometry_ref: input.geometry_ref,
    municipality: input.municipality,
    coordinates: input.coordinates,
    property_identity: input.property_identity,
    project_property_binding_ref: input.project_property_binding_ref,
    context_contract_version: PRODUCT_LU_CONTEXT_CONTRACT_VERSION,
  };
  return contextArtifact<LUPropertyContextArtifact>(
    "LU_PROPERTY_CONTEXT",
    [input.geometry_ref, input.project_property_binding_ref],
    payload,
  );
}

export function createProductLuProjectContextArtifact(input: {
  readonly project_id: string;
  readonly project_name: string;
  readonly description: string;
  readonly created_by: string;
  readonly property_context_ref: ArtifactReference;
  readonly project_property_binding_ref: ArtifactReference;
}): LUProjectContextArtifact {
  if (!input.project_id.trim() || !input.project_property_binding_ref?.artifact_id) {
    throw new Error("REJECT_PRODUCT_LU_PROJECT_CONTEXT: project and property binding are required");
  }
  const payload = {
    project_name: input.project_name,
    description: input.description,
    property_refs: [input.property_context_ref],
    created_by: input.created_by,
    project_id: input.project_id,
    project_property_binding_ref: input.project_property_binding_ref,
    context_contract_version: PRODUCT_LU_CONTEXT_CONTRACT_VERSION,
  };
  return contextArtifact<LUProjectContextArtifact>(
    "LU_PROJECT_CONTEXT",
    [input.property_context_ref, input.project_property_binding_ref],
    payload,
  );
}
