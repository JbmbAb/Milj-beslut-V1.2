import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { SpatialProviderPostGIS } from "../src/SpatialProviderPostGIS";
import { SpatialQueryRequest } from "@miljobeslut/mps-lu/services/SpatialQueryContract";

// Require a real db connection to run these tests
const dbUrl = process.env.TEST_DATABASE_URL || "postgresql://riskguard:password@127.0.0.1:5432/riskguard_test?sslmode=disable";

describe("SpatialProviderPostGIS Integration", () => {
  let provider: SpatialProviderPostGIS;

  beforeAll(() => {
    provider = new SpatialProviderPostGIS(dbUrl);
  });

  afterAll(async () => {
    await provider.close();
  });

  it("should return spatial evidence for water and ebh layers", async () => {
    const request: SpatialQueryRequest = {
      property_ref: {
        artifact_id: "prop_kristinehamn_1_123",
        artifact_type: "PROPERTY_REFERENCE",
        content_hash: "hash"
      },
      layers: ["water", "ebh"]
    };

    const evidence = await provider.query(request);
    
    // Vi förväntar oss minst en evidence från de mockade querysna
    expect(evidence).toBeInstanceOf(Array);
    expect(evidence.length).toBeGreaterThanOrEqual(1);

    const waterEvidence = evidence.find(e => e.payload.layer_ref === "layer_water");
    if (waterEvidence) {
      expect(waterEvidence.payload.source_metadata.dataset).toBe("water");
      expect(waterEvidence.payload.source_metadata.provider).toBeDefined();
    }
  });
});
