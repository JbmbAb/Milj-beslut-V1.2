import { createHash } from "node:crypto";
import { canonicalizeStrict } from "../../../mimers-brunn-core/src/serialization/canonicalize";
import type { SpatialEvidencePayload } from "./SpatialEvidenceArtifact";

/**
 * Spatial evidence identity (TV-S1, SV-I02 / SV-I06).
 *
 * The canonical version is part of the hash domain, not metadata beside it, so two
 * canonicalization rules can never collapse into one identity. This is C-02 applied to
 * the spatial domain. The `sv-` namespace belongs to the Spatial Governance Domain.
 *
 * @see docs/architecture/TV-S1-Spatial-Verification-Layer.md
 */
export const SPATIAL_CANONICAL_VERSION = "sv-canonical-1" as const;

/**
 * Identity inputs only. Wall-clock time, host, and operator are provenance: including
 * them would mean an identical re-execution produces a different hash, i.e. replay could
 * never succeed (SV-I06).
 *
 * `query_id` is a correlation handle for one request, not semantic content, so it is
 * excluded as well — otherwise the same analysis run twice would not be recognisable as
 * the same evidence.
 */
export function buildSpatialEvidenceIdentityPayload(
  payload: SpatialEvidencePayload,
): Record<string, unknown> {
  return {
    property_ref: {
      artifact_id: payload.property_ref.artifact_id,
      artifact_type: payload.property_ref.artifact_type,
    },
    layer_ref: {
      layer_id: payload.layer_ref.layer_id,
      layer_version: payload.layer_ref.layer_version,
    },
    srid: payload.srid,
    operation: {
      algorithm: payload.operation.algorithm,
      engine: payload.operation.engine,
    },
    parameters: payload.query_context.parameters,
    query_type: payload.query_context.query_type,
    geometry: payload.geometry ? {
      type: payload.geometry.type,
      coordinates: payload.geometry.coordinates,
    } : null,
    source: {
      provider: payload.source_metadata.provider,
      dataset: payload.source_metadata.dataset,
      dataset_version: payload.source_metadata.dataset_version,
    },
  };
}

/**
 * artifact_hash = SHA256( spatial_canonical_version || "\n" || canonical_payload )
 */
export function computeSpatialEvidenceHash(payload: SpatialEvidencePayload): string {
  const canonical = canonicalizeStrict(buildSpatialEvidenceIdentityPayload(payload));
  return createHash("sha256")
    .update(`${SPATIAL_CANONICAL_VERSION}\n${canonical}`, "utf8")
    .digest("hex");
}

export function buildSpatialEvidenceContentHash(payload: SpatialEvidencePayload): {
  readonly algorithm: "sha256";
  readonly value: string;
} {
  return { algorithm: "sha256", value: computeSpatialEvidenceHash(payload) };
}
