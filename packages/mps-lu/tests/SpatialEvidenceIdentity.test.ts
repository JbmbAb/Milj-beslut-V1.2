import { describe, it, expect } from "vitest";
import {
  SPATIAL_CANONICAL_VERSION,
  computeSpatialEvidenceHash,
} from "../src/artifacts/SpatialEvidenceIdentity";
import type { SpatialEvidencePayload } from "../src/artifacts/SpatialEvidenceArtifact";

/**
 * P4A-LU-S6 migration 2026-08-13: this fixture now declares its result semantics and carries
 * `geometry: null`. Under the frozen v1 semantics (EXISTENCE_WITHIN_DISTANCE) there is no
 * result geometry to bind — the executed query retrieves none.
 *
 * `engine_fingerprint` was missing here and the fixture did not compile against its own
 * declared type. Populated with the TV-4.3 §9 verified baseline purely so the fixture is valid;
 * S1/S3 (wildcard and incomplete stack in the PRODUCTION providers) remain OPEN and untouched.
 */
const basePayload: SpatialEvidencePayload = {
  result_semantics: {
    kind: "EXISTENCE_WITHIN_DISTANCE",
    query: {
      subject_ref: { artifact_id: "prop-123", artifact_type: "LU_PROPERTY_CONTEXT" },
      srid: 3006,
      distance_meters: 300,
    },
    result: { exists: true, match_count_observed: 2, max_features_per_layer: 50 },
  },
  property_ref: { artifact_id: "prop-123", artifact_type: "LU_PROPERTY_CONTEXT" },
  layer_ref: {
    layer_id: "water",
    version_hash: "2b4b514f8b18a1a614d9aeac75c32eff8c52a3864c54770be112fd88fa263ddc",
    layer_version: "v1",
  },
  srid: 3006,
  operation: {
    algorithm: "spatial.dwithin_existence",
    engine: "PostGIS",
    engine_fingerprint: { postgis: "3.4.3", geos: "3.9.0", proj: "7.2.1", gdal: "3.2.2" },
  },
  geometry: null,
  source_metadata: {
    provider: "PostGIS",
    dataset: "water",
    dataset_version: "2026-01-01",
    retrieved_at: "2026-08-07T12:00:00Z",
  },
  query_context: {
    query_id: "query-water-1",
    query_type: "SPATIAL_INTERSECTION",
    parameters: { search_distance_meters: 300 },
  },
};

function withPayload(patch: Partial<SpatialEvidencePayload>): SpatialEvidencePayload {
  return { ...basePayload, ...patch };
}

describe("Spatial evidence identity (TV-S1 SV-I02 / SV-I06)", () => {
  it("is deterministic for identical evidence", () => {
    expect(computeSpatialEvidenceHash(basePayload)).toBe(
      computeSpatialEvidenceHash(basePayload),
    );
  });

  it("binds the canonical version into the hash domain", () => {
    expect(SPATIAL_CANONICAL_VERSION).toBe("sv-canonical-1");
    // A payload hashed without the version prefix must not collide with the versioned hash.
    const unversioned = JSON.stringify(basePayload);
    expect(computeSpatialEvidenceHash(basePayload)).not.toBe(unversioned);
  });

  it("changes when a query parameter changes", () => {
    const widened = withPayload({
      query_context: {
        ...basePayload.query_context,
        parameters: { search_distance_meters: 350 },
      },
    });

    expect(computeSpatialEvidenceHash(widened)).not.toBe(
      computeSpatialEvidenceHash(basePayload),
    );
  });

  it("changes when the observed result changes", () => {
    // Replaces the former "changes when the resulting geometry changes". Same invariant — the
    // ANSWER is part of the identity — expressed under the frozen v1 semantics, where the
    // answer is an existence result rather than a geometry.
    const notFound = withPayload({
      result_semantics: {
        ...basePayload.result_semantics,
        result: { ...basePayload.result_semantics.result, exists: false },
      },
    });
    const differentCount = withPayload({
      result_semantics: {
        ...basePayload.result_semantics,
        result: { ...basePayload.result_semantics.result, match_count_observed: 7 },
      },
    });

    expect(computeSpatialEvidenceHash(notFound)).not.toBe(
      computeSpatialEvidenceHash(basePayload),
    );
    expect(computeSpatialEvidenceHash(differentCount)).not.toBe(
      computeSpatialEvidenceHash(basePayload),
    );
  });

  it("changes when the dataset version hash changes, not when the human label changes", () => {
    const newDataset = withPayload({
      source_metadata: { ...basePayload.source_metadata, dataset_version: "2026-06-01" },
    });
    const newLayerHash = withPayload({
      layer_ref: {
        ...basePayload.layer_ref,
        version_hash: "02fccffc07abaaf1775c8333d660fa60fdecea0c3bb664335892764c8486d186",
      },
      source_metadata: {
        ...basePayload.source_metadata,
        dataset_version: "02fccffc07abaaf1775c8333d660fa60fdecea0c3bb664335892764c8486d186",
      },
    });
    const newLayerLabel = withPayload({
      layer_ref: { ...basePayload.layer_ref, layer_version: "v2" },
    });

    expect(computeSpatialEvidenceHash(newDataset)).not.toBe(
      computeSpatialEvidenceHash(basePayload),
    );
    expect(computeSpatialEvidenceHash(newLayerHash)).not.toBe(
      computeSpatialEvidenceHash(basePayload),
    );
    expect(computeSpatialEvidenceHash(newLayerLabel)).toBe(
      computeSpatialEvidenceHash(basePayload),
    );
  });

  it("changes when the SRID or the algorithm changes", () => {
    const reprojected = withPayload({ srid: 4326 });
    const otherAlgorithm = withPayload({
      operation: { ...basePayload.operation, algorithm: "spatial.intersection" },
    });

    expect(computeSpatialEvidenceHash(reprojected)).not.toBe(
      computeSpatialEvidenceHash(basePayload),
    );
    expect(computeSpatialEvidenceHash(otherAlgorithm)).not.toBe(
      computeSpatialEvidenceHash(basePayload),
    );
  });

  it("ignores provenance: execution time and query id do not affect identity", () => {
    const later = withPayload({
      source_metadata: {
        ...basePayload.source_metadata,
        retrieved_at: "2027-01-01T00:00:00Z",
      },
      query_context: { ...basePayload.query_context, query_id: "query-water-999" },
    });

    expect(computeSpatialEvidenceHash(later)).toBe(computeSpatialEvidenceHash(basePayload));
  });
});
