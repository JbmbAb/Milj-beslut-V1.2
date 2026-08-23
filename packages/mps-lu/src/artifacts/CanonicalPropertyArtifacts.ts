import type { ArtifactContract, ArtifactReference } from "@miljobeslut/mps-compliance/src/artifacts/ArtifactContract";
import { sha256ContentHash } from "@miljobeslut/mps-compliance/src/canonical/sha256Canonical";

export const CANONICAL_PROPERTY_GEOMETRY_ARTIFACT_TYPE = "CANONICAL_PROPERTY_GEOMETRY" as const;
export const PROPERTY_LOOKUP_OBSERVATION_ARTIFACT_TYPE = "PROPERTY_LOOKUP_OBSERVATION" as const;
export const CANONICAL_PROPERTY_OBSERVATION_CONTRACT_VERSION = "canonical-property-observation-v1" as const;

export interface CanonicalPropertyGeometryArtifact extends ArtifactContract {
  readonly artifact_type: typeof CANONICAL_PROPERTY_GEOMETRY_ARTIFACT_TYPE;
  readonly payload: {
    readonly geometry: Record<string, unknown>;
    readonly srid: 4326;
    readonly contract_version: typeof CANONICAL_PROPERTY_OBSERVATION_CONTRACT_VERSION;
  };
}

export interface PropertyLookupObservationArtifact extends ArtifactContract {
  readonly artifact_type: typeof PROPERTY_LOOKUP_OBSERVATION_ARTIFACT_TYPE;
  readonly payload: {
    readonly property_identity: string;
    readonly property_designation: string;
    readonly source_key: string;
    readonly source_dataset: string;
    readonly source_updated_at: string;
    readonly municipality: string | null;
    readonly geometry_ref: ArtifactReference;
    readonly resolver_id: "postgis-property-unit-exact";
    readonly resolver_version: typeof CANONICAL_PROPERTY_OBSERVATION_CONTRACT_VERSION;
  };
}

function required(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`REJECT_CANONICAL_PROPERTY_OBSERVATION: ${field} is required`);
  return normalized;
}

function artifact<T extends ArtifactContract>(
  artifactType: T["artifact_type"],
  references: readonly ArtifactReference[],
  payload: T["payload"],
): T {
  const identity = sha256ContentHash({
    canonicalizer_id: "rfc8785-sha256-v1",
    artifact_type: artifactType,
    payload,
  });
  const body = {
    artifact_id: `${artifactType.toLowerCase()}-${identity.value.slice(0, 24)}`,
    artifact_type: artifactType,
    references,
    payload,
  } as Omit<T, "content_hash">;
  return { ...body, content_hash: sha256ContentHash(body) } as T;
}

export function createCanonicalPropertyGeometryArtifact(input: {
  readonly geometry: Record<string, unknown>;
}): CanonicalPropertyGeometryArtifact {
  if (!input.geometry || typeof input.geometry !== "object") {
    throw new Error("REJECT_CANONICAL_PROPERTY_OBSERVATION: geometry is required");
  }
  return artifact<CanonicalPropertyGeometryArtifact>(
    CANONICAL_PROPERTY_GEOMETRY_ARTIFACT_TYPE,
    [],
    {
      geometry: input.geometry,
      srid: 4326,
      contract_version: CANONICAL_PROPERTY_OBSERVATION_CONTRACT_VERSION,
    },
  );
}

export function createPropertyLookupObservationArtifact(input: {
  readonly property_identity: string;
  readonly property_designation: string;
  readonly source_key: string;
  readonly source_dataset: string;
  readonly source_updated_at: string;
  readonly municipality: string | null;
  readonly geometry_ref: ArtifactReference;
}): PropertyLookupObservationArtifact {
  const payload: PropertyLookupObservationArtifact["payload"] = {
    property_identity: required(input.property_identity, "property_identity"),
    property_designation: required(input.property_designation, "property_designation"),
    source_key: required(input.source_key, "source_key"),
    source_dataset: required(input.source_dataset, "source_dataset"),
    source_updated_at: required(input.source_updated_at, "source_updated_at"),
    municipality: input.municipality?.trim() || null,
    geometry_ref: input.geometry_ref,
    resolver_id: "postgis-property-unit-exact",
    resolver_version: CANONICAL_PROPERTY_OBSERVATION_CONTRACT_VERSION,
  };
  return artifact<PropertyLookupObservationArtifact>(
    PROPERTY_LOOKUP_OBSERVATION_ARTIFACT_TYPE,
    [payload.geometry_ref],
    payload,
  );
}
