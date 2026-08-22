import type { ArtifactContract, ArtifactReference } from "@miljobeslut/mps-compliance/src/artifacts/ArtifactContract";
import { sha256ContentHash } from "@miljobeslut/mps-compliance/src/canonical/sha256Canonical";

/**
 * PRODUCT-LU-LOCALIZATION-GEOMETRY-01 Phase B.
 *
 * The explicit, real distinction the runtime previously did not make:
 *   PROPERTY   = cadastral context (ProjectPropertyBindingArtifact / LUPropertyContextArtifact)
 *   PROJECT    = Mimer container/history/auth boundary (Project, ProjectContextBinding)
 *   LOCALIZATION GEOMETRY (this artifact) = the explicit location actually being assessed
 *
 * V1 admits POINT only -- see LU-CESIUM-PROPERTY-GEOMETRY-LIFECYCLE-01/this unit's Phase A
 * recon: the live spatial provider's query is centroid-only today, so a
 * point is immediately wireable without opening polygon-aware provider design. A polygon
 * `geometry_type` is deliberately not in the admitted set yet, not merely unimplemented --
 * `validateLocalizationGeometryArtifact` REJECTs it rather than silently reducing it to a point.
 *
 * NOT owner-signed. Unlike ProjectContextBinding/ExecutionIdentity (governance authority, who is
 * permitted to operate), this is user content (what the user wants assessed) -- the same trust
 * tier as today's assessment_draft/site.id. Content-hash identity (immutability + idempotency +
 * tamper-evidence) is the correct and sufficient integrity guarantee; requiring the owner's
 * private key here would misapply the narrow authority boundary this session has otherwise kept.
 *
 * `coordinates` mirrors LUPropertyContextArtifact's existing dual representation exactly: `geometry`
 * carries the WGS84 GeoJSON Point (browser/Cesium-facing, [lng, lat]), `coordinates` carries the
 * SWEREF99 TM canonical [northing, easting] pair the live spatial query actually consumes -- the
 * same explicit N/E convention `centroidToCanonicalCoordinates` already established, never
 * inferred from numeric ranges.
 */
export const LOCALIZATION_GEOMETRY_CONTRACT_VERSION = "localization-geometry-v1" as const;
export const LOCALIZATION_GEOMETRY_ADMITTED_TYPES = ["POINT"] as const;
export type LocalizationGeometryType = (typeof LOCALIZATION_GEOMETRY_ADMITTED_TYPES)[number];

export type LocalizationGeometryProvenance = "user_defined" | "derived_from_property_boundary";

export interface LocalizationPointGeometry {
  readonly type: "Point";
  /** WGS84 GeoJSON order: [lng, lat]. */
  readonly coordinates: readonly [number, number];
}

export interface LocalizationGeometryPayload {
  readonly project_id: string;
  readonly property_context_ref: ArtifactReference;
  readonly geometry_type: LocalizationGeometryType;
  readonly geometry: LocalizationPointGeometry;
  /** SWEREF99 TM canonical [northing, easting] -- what the live spatial query consumes. */
  readonly coordinates: readonly [number, number];
  readonly srid: number;
  readonly provenance: LocalizationGeometryProvenance;
  readonly label: string;
  readonly created_by: string;
  readonly geometry_contract_version: string;
}

export interface LocalizationGeometryArtifact extends ArtifactContract {
  readonly artifact_type: "localization_geometry";
  readonly payload: LocalizationGeometryPayload;
}

const SRID_SWEREF99TM = 3006;

function isFiniteCoordinatePair(value: unknown): value is readonly [number, number] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    value.every((n) => typeof n === "number" && Number.isFinite(n))
  );
}

/**
 * Structural validation only (shape, admitted type, SRID, coordinate finiteness) -- never trust
 * for provenance/authority. Callers that need to trust this artifact against a specific project
 * or property must additionally check `payload.project_id` / `payload.property_context_ref`
 * themselves against their own real state (see server/modules/localization/
 * localizationGeometryProjection.ts), and re-verify content_hash from the resolved CAS body --
 * this function does not do either.
 */
export function validateLocalizationGeometryArtifact(
  artifact: LocalizationGeometryArtifact,
): LocalizationGeometryArtifact {
  if (artifact.artifact_type !== "localization_geometry") {
    throw new Error("REJECT_LOCALIZATION_GEOMETRY: wrong artifact_type");
  }
  const p = artifact.payload;
  if (!p?.project_id?.trim()) {
    throw new Error("REJECT_LOCALIZATION_GEOMETRY: project_id is required");
  }
  if (!p.property_context_ref?.artifact_id) {
    throw new Error("REJECT_LOCALIZATION_GEOMETRY: property_context_ref is required");
  }
  if (!LOCALIZATION_GEOMETRY_ADMITTED_TYPES.includes(p.geometry_type as LocalizationGeometryType)) {
    throw new Error(`REJECT_LOCALIZATION_GEOMETRY_UNSUPPORTED_TYPE: ${p.geometry_type}`);
  }
  if (p.geometry?.type !== "Point" || !isFiniteCoordinatePair(p.geometry.coordinates)) {
    throw new Error("REJECT_LOCALIZATION_GEOMETRY: geometry must be a valid GeoJSON Point");
  }
  if (p.srid !== SRID_SWEREF99TM) {
    throw new Error(`REJECT_LOCALIZATION_GEOMETRY_UNSUPPORTED_SRID: ${p.srid}`);
  }
  if (!isFiniteCoordinatePair(p.coordinates)) {
    throw new Error("REJECT_LOCALIZATION_GEOMETRY: coordinates must be a finite [northing, easting] pair");
  }
  if (p.provenance !== "user_defined" && p.provenance !== "derived_from_property_boundary") {
    throw new Error(`REJECT_LOCALIZATION_GEOMETRY_UNKNOWN_PROVENANCE: ${p.provenance}`);
  }
  if (!p.created_by?.trim()) {
    throw new Error("REJECT_LOCALIZATION_GEOMETRY: created_by is required");
  }
  const recomputed = sha256ContentHash({
    artifact_id: artifact.artifact_id,
    artifact_type: artifact.artifact_type,
    references: artifact.references,
    payload: p,
  });
  if (recomputed.value !== artifact.content_hash?.value) {
    throw new Error("REJECT_LOCALIZATION_GEOMETRY: content_hash mismatch (tampered or malformed)");
  }

  const expectedIdentityHash = sha256ContentHash({
    artifact_type: "localization_geometry",
    contract_version: LOCALIZATION_GEOMETRY_CONTRACT_VERSION,
    payload: p,
  });
  if (artifact.artifact_id !== `localization-geometry-${expectedIdentityHash.value.slice(0, 24)}`) {
    throw new Error("REJECT_LOCALIZATION_GEOMETRY: artifact_id does not match its own payload (tampered or malformed)");
  }
  return artifact;
}

export function createLocalizationGeometryArtifact(input: {
  readonly project_id: string;
  readonly property_context_ref: ArtifactReference;
  /** WGS84 [lng, lat] -- the same order fetchPropertyInfo/Cesium already use. */
  readonly wgs84LngLat: readonly [number, number];
  /** SWEREF99 TM canonical [northing, easting] -- caller must derive this explicitly, never inferred here. */
  readonly sweref99NorthingEasting: readonly [number, number];
  readonly provenance: LocalizationGeometryProvenance;
  readonly label: string;
  readonly created_by: string;
}): LocalizationGeometryArtifact {
  if (!input.project_id.trim()) {
    throw new Error("REJECT_LOCALIZATION_GEOMETRY: project_id is required");
  }
  if (!input.property_context_ref?.artifact_id) {
    throw new Error("REJECT_LOCALIZATION_GEOMETRY: property_context_ref is required");
  }
  if (!isFiniteCoordinatePair(input.wgs84LngLat) || !isFiniteCoordinatePair(input.sweref99NorthingEasting)) {
    throw new Error("REJECT_LOCALIZATION_GEOMETRY: coordinates must be finite [number, number] pairs");
  }
  if (!input.created_by.trim()) {
    throw new Error("REJECT_LOCALIZATION_GEOMETRY: created_by is required");
  }

  const payload: LocalizationGeometryPayload = {
    project_id: input.project_id,
    property_context_ref: input.property_context_ref,
    geometry_type: "POINT",
    geometry: { type: "Point", coordinates: input.wgs84LngLat },
    coordinates: input.sweref99NorthingEasting,
    srid: SRID_SWEREF99TM,
    provenance: input.provenance,
    label: input.label,
    created_by: input.created_by,
    geometry_contract_version: LOCALIZATION_GEOMETRY_CONTRACT_VERSION,
  };

  const identityHash = sha256ContentHash({
    artifact_type: "localization_geometry",
    contract_version: LOCALIZATION_GEOMETRY_CONTRACT_VERSION,
    payload,
  });

  const bare = {
    artifact_id: `localization-geometry-${identityHash.value.slice(0, 24)}`,
    artifact_type: "localization_geometry" as const,
    references: [input.property_context_ref],
    payload,
  };

  return {
    ...bare,
    content_hash: sha256ContentHash(bare),
  };
}
