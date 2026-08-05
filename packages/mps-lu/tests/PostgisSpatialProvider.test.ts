import { describe, it, expect, vi, beforeEach } from "vitest";
import { PostgisSpatialProvider, PostgisQueryFunction, ArtifactLoaderFunction } from "../src/providers/PostgisSpatialProvider";
import { SpatialQueryRequest } from "../src/services/SpatialQueryContract";
import { LUPropertyContextArtifact } from "../src/artifacts/LUPropertyContextArtifact";

describe("PostgisSpatialProvider", () => {
  let mockQueryFn: any;
  let mockLoader: any;
  let provider: PostgisSpatialProvider;

  beforeEach(() => {
    mockQueryFn = vi.fn();
    mockLoader = vi.fn();
    provider = new PostgisSpatialProvider(mockQueryFn, mockLoader);
  });

  it("should resolve property context and execute spatial queries for requested layers", async () => {
    const mockProperty: LUPropertyContextArtifact = {
      artifact_id: "prop-123",
      artifact_type: "LU_PROPERTY_CONTEXT",
      content_hash: { algorithm: "sha256", value: "hash" },
      references: [],
      payload: {
        property_ref: "TEST 1:1",
        official_name: "Test",
        geometry_ref: { artifact_id: "geom", artifact_type: "CANONICAL_GEOMETRY" },
        municipality: "Stockholm",
        coordinates: [6612345, 591234], // N, E
      }
    };

    // Make the artifact loader return our mock property context
    mockLoader.mockResolvedValue(mockProperty);

    // Make the query function return a match for water, no match for ebh (repeatable)
    mockQueryFn.mockImplementation(async (sql: string) => {
      if (sql.includes("env.sgu_well_actual")) return [{ "?column?": 1 }];
      return [];
    });

    const request: SpatialQueryRequest = {
      property_ref: { artifact_id: "prop-123", artifact_type: "LU_PROPERTY_CONTEXT" },
      layers: ["water", "ebh", "unknown_layer"]
    };

    const evidence = await provider.query(request);

    // Assertions
    expect(mockLoader).toHaveBeenCalledWith(request.property_ref);
    expect(mockQueryFn).toHaveBeenCalledTimes(2); // unknown_layer should be skipped

    // Verify first query was for water
    expect(mockQueryFn.mock.calls[0][0]).toContain("env.sgu_well_actual");
    expect(mockQueryFn.mock.calls[0][1]).toEqual([591234, 6612345]); // [lng, lat] -> [E, N]

    // Verify second query was for ebh
    expect(mockQueryFn.mock.calls[1][0]).toContain("env.ebh_potentiellt_fororenade_omraden");
    expect(mockQueryFn.mock.calls[1][1]).toEqual([591234, 6612345]); // [E, N]

    // Verify evidence is mapped correctly
    expect(evidence).toHaveLength(1);
    expect(evidence[0].payload.layer_ref.layer_id).toBe("water");
    expect(evidence[0].payload.source_metadata.dataset).toBe("water");
    // Deterministic id/hash (no wall-clock)
    expect(evidence[0].artifact_id).toMatch(/^evidence-water-[a-f0-9]{16}$/);
    expect(evidence[0].content_hash.algorithm).toBe("sha256");
    expect(evidence[0].content_hash.value).toHaveLength(64);
    expect(evidence[0].payload.source_metadata.retrieved_at).toMatch(/^seed:/);
    const again = await provider.query(request);
    expect(again[0].artifact_id).toBe(evidence[0].artifact_id);
    expect(again[0].content_hash.value).toBe(evidence[0].content_hash.value);
  });

  it("should throw if property context cannot be loaded or is invalid", async () => {
    mockLoader.mockResolvedValue(null);

    const request: SpatialQueryRequest = {
      property_ref: { artifact_id: "invalid-prop", artifact_type: "LU_PROPERTY_CONTEXT" },
      layers: ["water"]
    };

    await expect(provider.query(request)).rejects.toThrow(/Failed to load valid property context/);
    expect(mockQueryFn).not.toHaveBeenCalled();
  });
});
