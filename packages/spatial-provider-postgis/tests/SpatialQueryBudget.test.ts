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
      "protected_area",
      "water",
    ]);
    expect(resolveLayerBinding("water").table).toBe("env.sgu_well");
    expect(() => resolveLayerBinding("unknown_layer")).toThrow(/REJECT_SPATIAL_LAYER/);
  });
});
