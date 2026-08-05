import { describe, it, expect } from "vitest";
import {
  LU_REGISTRY_SNAPSHOT,
  LU_CAPABILITY_DEFINITION_HASH,
  LU_WORKFLOW_DEFINITION_HASH,
} from "../src/registry/LuSiteAssessmentRegistry.js";

describe("LuSiteAssessmentRegistry", () => {
  it("uses real sha256 hashes (not mock-*-hash)", () => {
    expect(LU_REGISTRY_SNAPSHOT.content_hash.algorithm).toBe("sha256");
    expect(LU_REGISTRY_SNAPSHOT.content_hash.value).toHaveLength(64);
    expect(LU_REGISTRY_SNAPSHOT.content_hash.value).not.toMatch(/mock/);
    expect(LU_CAPABILITY_DEFINITION_HASH.value).not.toMatch(/mock/);
    expect(LU_WORKFLOW_DEFINITION_HASH.value).not.toMatch(/mock/);
  });

  it("includes site assessment capability and workflow", () => {
    expect(LU_REGISTRY_SNAPSHOT.capabilities[0].capability_key).toBe(
      "lu.site_assessment",
    );
    expect(LU_REGISTRY_SNAPSHOT.workflows[0].steps).toHaveLength(3);
  });
});
