import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { SpatialProviderPostGIS } from "../src/SpatialProviderPostGIS";
import { SpatialQueryRequest } from "@miljobeslut/mps-lu/src/services/SpatialQueryContract";
import { LUPropertyContextArtifact } from "@miljobeslut/mps-lu";
import { MimersIntegration } from "../../mps-runtime/src/mimers/index";
import { ArtifactRepositoryPort } from "../../mps-runtime/src/kernel/ExecutionKernel";

// Require a real db connection to run these tests
const dbUrl = process.env.TEST_DATABASE_URL || "postgresql://riskguard:password@127.0.0.1:5432/riskguard_test?sslmode=disable";

describe("SpatialProviderPostGIS Integration", () => {
  let provider: SpatialProviderPostGIS;
  let repo: ArtifactRepositoryPort;

  beforeAll(async () => {
    const mimers = await MimersIntegration.create();
    repo = mimers.artifactRepository;
    provider = new SpatialProviderPostGIS(dbUrl, repo);

    // Seed test geometries in PostGIS at the exact coordinates [6612345, 591234]
    const { Client } = await import("pg");
    const client = new Client({ connectionString: dbUrl });
    await client.connect();

    // Clear any leftover test data
    await client.query("DELETE FROM env.sgu_well WHERE id >= 999700 AND id <= 999799");
    await client.query("DELETE FROM env.ebh_potentiellt_fororenade_omraden WHERE fid >= 999700 AND fid <= 999799");

    // 1. env.sgu_well
    await client.query(`
      INSERT INTO env.sgu_well (id, geom)
      VALUES (999700, ST_SetSRID(ST_MakePoint(591234, 6612345), 3006))
    `);

    // 2. env.ebh_potentiellt_fororenade_omraden
    await client.query(`
      INSERT INTO env.ebh_potentiellt_fororenade_omraden (fid, geom)
      VALUES (999700, ST_Multi(ST_SetSRID(ST_MakePoint(591234, 6612345), 3006)))
    `);

    await client.end();
  });

  afterAll(async () => {
    // Cleanup seeded geometries
    const { Client } = await import("pg");
    const client = new Client({ connectionString: dbUrl });
    await client.connect();
    await client.query("DELETE FROM env.sgu_well WHERE id >= 999700 AND id <= 999799");
    await client.query("DELETE FROM env.ebh_potentiellt_fororenade_omraden WHERE fid >= 999700 AND fid <= 999799");
    await client.end();

    await provider.close();
  });

  it("should return spatial evidence for water and ebh layers", async () => {
    const propertyContext: LUPropertyContextArtifact = {
      artifact_id: "prop_kristinehamn_1_123",
      artifact_type: "LU_PROPERTY_CONTEXT",
      content_hash: { algorithm: "sha256", value: "hash_prop_kris" },
      references: [],
      payload: {
        property_ref: "KRISTINEHAMN 1:123",
        official_name: "Kristinehamn 1:123",
        geometry_ref: { artifact_id: "geom_kris", artifact_type: "CANONICAL_GEOMETRY" },
        municipality: "Kristinehamn",
        coordinates: [6612345, 591234],
      }
    };

    await repo.put({
      artifact_id: propertyContext.artifact_id,
      content_hash: propertyContext.content_hash,
      body: propertyContext,
    });

    const request: SpatialQueryRequest = {
      property_ref: {
        artifact_id: propertyContext.artifact_id,
        artifact_type: propertyContext.artifact_type,
      },
      layers: [
        { name: "water", version_hash: "v1.0" },
        { name: "ebh", version_hash: "v1.0" }
      ]
    };

    const evidence = await provider.query(request);
    
    // Vi förväntar oss minst en evidence från de mockade querysna
    expect(evidence).toBeInstanceOf(Array);
    expect(evidence.length).toBeGreaterThanOrEqual(1);

    const waterEvidence = evidence.find(e => e.payload.layer_ref.layer_id === "water");
    if (waterEvidence) {
      expect(waterEvidence.payload.source_metadata.dataset).toBe("water");
      expect(waterEvidence.payload.source_metadata.provider).toBeDefined();
    }
  });

  it("persists a truthful negative existence observation instead of dropping it", async () => {
    const propertyContext: LUPropertyContextArtifact = {
      artifact_id: "prop_no_spatial_hit",
      artifact_type: "LU_PROPERTY_CONTEXT",
      content_hash: { algorithm: "sha256", value: "hash_prop_no_hit" },
      references: [],
      payload: {
        property_ref: "TEST NO HIT 1:1",
        official_name: "Test no hit",
        geometry_ref: { artifact_id: "geom_no_hit", artifact_type: "CANONICAL_GEOMETRY" },
        municipality: "Test",
        coordinates: [0, 0],
      },
    };
    await repo.put({
      artifact_id: propertyContext.artifact_id,
      content_hash: propertyContext.content_hash,
      body: propertyContext,
    });

    const evidence = await provider.query({
      property_ref: {
        artifact_id: propertyContext.artifact_id,
        artifact_type: propertyContext.artifact_type,
      },
      layers: [{ name: "water", version_hash: "v1.0" }],
    });

    expect(evidence).toHaveLength(1);
    expect(evidence[0].payload.result_semantics.result).toMatchObject({
      exists: false,
      match_count_observed: 0,
    });
    expect(evidence[0].payload.geometry).toBeNull();
  });
});
