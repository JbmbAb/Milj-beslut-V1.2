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

/**
 * LOCALIZATION-GEOMETRY-CANONICALIZATION-V2 (CANONICAL-SEMANTIC-INPUTS-V1, H1).
 *
 * Frozen owner decision: raw browser WGS84 floats and raw PostGIS-transform SWEREF floats were
 * both identity-bearing under V1 with zero quantization -- two numerically-equivalent
 * representations of the SAME intended coordinate (not two nearby-but-distinct user choices)
 * could mint different artifact identities. V2 makes EPSG:3006 (SWEREF99 TM) the single
 * authoritative representation: the metric N/E pair is quantized independently to a 0.1m grid,
 * and WGS84 is DERIVED from that already-quantized SWEREF point (never independently quantized)
 * -- so there is exactly one canonicalization step, not two representations that could drift
 * apart. 0.1m was chosen deliberately over 1m: measured transform/round-trip noise is ~1e-14deg
 * (~sub-nanometer), so even the tightest grid considered leaves an enormous margin over noise;
 * the grid size is a statement about product-meaningful precision, not measurement uncertainty,
 * and a 1m grid risked collapsing two genuinely distinct siting choices ~60cm apart into the same
 * identity. `contract_version` is baked into the identity hash domain (see
 * createLocalizationGeometryArtifactV2 / validateLocalizationGeometryArtifact), so V1 and V2
 * artifacts for numerically-identical inputs never collide -- no separate ID prefix is needed.
 */
export const LOCALIZATION_GEOMETRY_CONTRACT_VERSION_V2 = "localization-geometry-v2" as const;
export const LOCALIZATION_GEOMETRY_CANONICAL_GRID_M = 0.1;
export const LOCALIZATION_GEOMETRY_CANONICAL_SRID = 3006;

/** Independent per-axis quantization to the frozen 0.1m grid. Uses integer rounding on a
 *  fixed x10 scale (not division by 0.1) so the SAME grid cell always produces the exact same
 *  IEEE754 double, deterministically, regardless of which raw input mapped into it. Normalizes
 *  -0 -> 0 so a point quantizing to exactly zero on either axis never carries a sign bit into
 *  identity (RFC8785 already does this at the hash-serialization layer, but this makes it
 *  explicit and correct at the value's point of construction too, not only incidentally true
 *  because of a downstream library). */
export function quantizeToLocalizationGeometryGrid(value: number): number {
  const scaled = Math.round(value * 10);
  const quantized = scaled / 10;
  return Object.is(quantized, -0) ? 0 : quantized;
}

/** True iff `value` is already exactly the canonical-grid quantization of itself -- i.e. it was
 *  produced by (or is indistinguishable from) `quantizeToLocalizationGeometryGrid`. Used to
 *  fail-closed reject a V2 artifact whose SWEREF coordinate was not actually quantized, rather
 *  than silently re-quantizing at validation time (which would let a non-canonical value slip
 *  through with a V2 label). */
export function isOnLocalizationGeometryCanonicalGrid(value: number): boolean {
  return quantizeToLocalizationGeometryGrid(value) === value;
}

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

  /**
   * LOCALIZATION-GEOMETRY-CANONICALIZATION-V2, H1 Phase B: version-aware dispatch. `payload.
   * geometry_contract_version` was previously a decorative field -- identity was always
   * recomputed against the hardcoded V1 constant regardless of what a payload actually declared,
   * which would have silently corrupted V2 verification (or, worse, let a mislabeled artifact
   * validate under the wrong rule set). Every historical V1 artifact must keep validating under
   * EXACTLY the V1 rule that minted it -- never re-hashed, never reinterpreted.
   */
  let contractVersion: string;
  if (p.geometry_contract_version === LOCALIZATION_GEOMETRY_CONTRACT_VERSION) {
    contractVersion = LOCALIZATION_GEOMETRY_CONTRACT_VERSION;
  } else if (p.geometry_contract_version === LOCALIZATION_GEOMETRY_CONTRACT_VERSION_V2) {
    contractVersion = LOCALIZATION_GEOMETRY_CONTRACT_VERSION_V2;
    // V2-only rule: the metric coordinate must already be on the canonical 0.1m grid -- a V2-
    // labeled artifact whose coordinate isn't actually quantized is rejected, not silently
    // trusted or re-quantized at read time.
    if (
      !isOnLocalizationGeometryCanonicalGrid(p.coordinates[0]) ||
      !isOnLocalizationGeometryCanonicalGrid(p.coordinates[1])
    ) {
      throw new Error("REJECT_LOCALIZATION_GEOMETRY_V2: coordinates are not on the canonical 0.1m grid");
    }
  } else {
    throw new Error(`REJECT_LOCALIZATION_GEOMETRY: unknown geometry_contract_version '${p.geometry_contract_version}'`);
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
    contract_version: contractVersion,
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

/**
 * LOCALIZATION-GEOMETRY-CANONICALIZATION-V2. `sweref99NorthingEasting` MUST already be quantized
 * to the canonical 0.1m grid (`quantizeToLocalizationGeometryGrid`) by the caller -- this
 * constructor stays pure (no I/O) and REJECTs a non-canonical value rather than silently
 * re-quantizing, so a caller cannot accidentally construct a V2 artifact around a value it never
 * actually canonicalized. `wgs84LngLat` must be the representation DERIVED from that same
 * already-quantized SWEREF point (via a fresh SWEREF->WGS84 transform) -- never independently
 * quantized -- so there is exactly one canonicalization step, not two representations that could
 * drift apart from each other.
 */
export function createLocalizationGeometryArtifactV2(input: {
  readonly project_id: string;
  readonly property_context_ref: ArtifactReference;
  /** WGS84 [lng, lat], derived from the already-quantized SWEREF point. */
  readonly wgs84LngLat: readonly [number, number];
  /** SWEREF99 TM canonical [northing, easting] -- MUST already be on the 0.1m grid. */
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
  if (
    !isOnLocalizationGeometryCanonicalGrid(input.sweref99NorthingEasting[0]) ||
    !isOnLocalizationGeometryCanonicalGrid(input.sweref99NorthingEasting[1])
  ) {
    throw new Error(
      "REJECT_LOCALIZATION_GEOMETRY_V2: sweref99NorthingEasting must already be quantized to the canonical 0.1m grid (use quantizeToLocalizationGeometryGrid before calling this)",
    );
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
    geometry_contract_version: LOCALIZATION_GEOMETRY_CONTRACT_VERSION_V2,
  };

  const identityHash = sha256ContentHash({
    artifact_type: "localization_geometry",
    contract_version: LOCALIZATION_GEOMETRY_CONTRACT_VERSION_V2,
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
