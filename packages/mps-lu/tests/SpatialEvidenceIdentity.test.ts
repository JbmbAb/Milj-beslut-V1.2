import { describe, it, expect } from "vitest";
import {
  SPATIAL_CANONICAL_VERSION,
  computeSpatialEvidenceHash,
} from "../src/artifacts/SpatialEvidenceIdentity";
import type { SpatialEvidencePayload } from "../src/artifacts/SpatialEvidenceArtifact";

const basePayload: SpatialEvidencePayload = {
  property_ref: { artifact_id: "prop-123", artifact_type: "LU_PROPERTY_CONTEXT" },
  layer_ref: { layer_id: "water", layer_version: "v1" },
  srid: 3006,
  operation: { algorithm: "spatial.dwithin_existence", engine: "PostGIS" },
  geometry: {
    type: "Polygon",
    coordinates: [
      [
        [591234, 6612345],
        [591235, 6612345],
        [591235, 6612346],
        [591234, 6612346],
        [591234, 6612345],
      ],
    ],
  },
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

  it("changes when the resulting geometry changes", () => {
    const moved = withPayload({
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [591334, 6612345],
            [591335, 6612345],
            [591335, 6612346],
            [591334, 6612346],
            [591334, 6612345],
          ],
        ],
      },
    });

    expect(computeSpatialEvidenceHash(moved)).not.toBe(
      computeSpatialEvidenceHash(basePayload),
    );
  });

  it("changes when the dataset or layer version changes", () => {
    const newDataset = withPayload({
      source_metadata: { ...basePayload.source_metadata, dataset_version: "2026-06-01" },
    });
    const newLayer = withPayload({
      layer_ref: { ...basePayload.layer_ref, layer_version: "v2" },
    });

    expect(computeSpatialEvidenceHash(newDataset)).not.toBe(
      computeSpatialEvidenceHash(basePayload),
    );
    expect(computeSpatialEvidenceHash(newLayer)).not.toBe(
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
