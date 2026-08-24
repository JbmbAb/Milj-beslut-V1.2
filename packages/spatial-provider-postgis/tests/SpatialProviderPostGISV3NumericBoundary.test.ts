import { describe, expect, it, vi } from "vitest";
import { SpatialProviderPostGIS } from "../src/SpatialProviderPostGIS";

const PROPERTY_REF = {
  artifact_id: "property-context-v3-numeric-boundary",
  artifact_type: "LU_PROPERTY_CONTEXT",
} as const;

describe("SPATIAL-NUMERIC-CONTRACT-V1 product provider boundary (H6)", () => {
  it("rejects a fractional V3 distance before it can issue a PostGIS query", async () => {
    const repository = {
      resolve: vi.fn().mockResolvedValue({ payload: { coordinates: [6580743, 674572] } }),
    };
    const provider = new SpatialProviderPostGIS(
      "postgresql://invalid:invalid@127.0.0.1:1/isolated?sslmode=disable",
      repository as never,
    );
    const query = vi.fn();
    (provider as unknown as { pool: { query: typeof query } }).pool = { query };

    await expect(
      provider.query({
        property_ref: PROPERTY_REF,
        buffer_distance_meters: 500.5,
        layers: [{ name: "water", version_hash: "a".repeat(64) }],
      }),
    ).rejects.toThrow("REJECT_SPATIAL_QUERY_CONTRACT_V3_NUMERIC_PARAMETERS");

    expect(repository.resolve).toHaveBeenCalledWith(PROPERTY_REF);
    expect(query).not.toHaveBeenCalled();
  });
});
