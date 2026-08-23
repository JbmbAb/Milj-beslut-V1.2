import { describe, it, expect } from "vitest";
import { DEFAULT_SPATIAL_QUERY_BUDGET } from "@miljobeslut/mps-lu";
import { resolveLayerBinding, SPATIAL_LAYER_REGISTRY } from "../src/SpatialLayerRegistry";

describe("SpatialQueryBudget + layer registry", () => {
  it("exposes fail-closed default budget bounds", () => {
    expect(DEFAULT_SPATIAL_QUERY_BUDGET.max_layers).toBeLessThanOrEqual(8);
    expect(DEFAULT_SPATIAL_QUERY_BUDGET.max_features_per_layer).toBeLessThanOrEqual(50);
    expect(DEFAULT_SPATIAL_QUERY_BUDGET.max_distance_meters).toBeLessThanOrEqual(2000);
  });

  it("resolves only registered LU layers", () => {
    expect(Object.keys(SPATIAL_LAYER_REGISTRY).sort()).toEqual([
      "ebh",
      "natura2000",
      "protected_area",
      "water",
      "water_protection_area",
    ]);
    expect(resolveLayerBinding("water").table).toBe("env.sgu_well");
    expect(resolveLayerBinding("natura2000")).toMatchObject({
      table: "env.natura2000_area",
      provider: "Naturvårdsverket",
      version_hash: "a5d665ae7bfde9ebeaa4883d5db7bbf70aea9cb7ad5a3f621c4cdbc003ad7f02",
      geom_column: "geom",
    });
    expect(resolveLayerBinding("water_protection_area")).toMatchObject({
      table: "env.water_protection_area",
      provider: "Naturvårdsverket",
      version_hash: "ba6fdd88fa478d9b930a41153d03b84a34b086de8d6c5aa0f6b63c0b4dd6ff18",
      geom_column: "geom",
    });
    expect(() => resolveLayerBinding("unknown_layer")).toThrow(/REJECT_SPATIAL_LAYER/);
  });
});
