import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { SpatialProviderPostGIS } from "../src/SpatialProviderPostGIS";
import { LUProjectContextArtifact } from "@miljobeslut/mps-lu";
import { LUPropertyContextArtifact } from "@miljobeslut/mps-lu";
import { LocalizationAssessmentArtifact } from "@miljobeslut/mps-lu";
import { runLuAssessmentViaKernel } from "@miljobeslut/mps-lu";
import { ArtifactReference } from "@miljobeslut/mps-compliance/src/artifacts/ArtifactContract";
import { MimersIntegration } from "../../mps-runtime/src/mimers/index";
import { ArtifactRepositoryPort } from "../../mps-runtime/src/kernel/ExecutionKernel";

const dbUrl = process.env.TEST_DATABASE_URL || "postgresql://riskguard:password@127.0.0.1:5432/riskguard_test?sslmode=disable";

describe("LU Domain - PostGIS Magic Moment", () => {
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
    await client.query("DELETE FROM env.sgu_well WHERE id >= 999900");
    await client.query("DELETE FROM env.ebh_potentiellt_fororenade_omraden WHERE fid >= 999900");
    await client.query("DELETE FROM env.protected_area WHERE nvrid = 'NVR-TEST-MAGIC'");

    // 1. env.sgu_well
    await client.query(`
      INSERT INTO env.sgu_well (id, geom)
      VALUES (999900, ST_SetSRID(ST_MakePoint(591234, 6612345), 3006))
    `);

    // 2. env.ebh_potentiellt_fororenade_omraden
    await client.query(`
      INSERT INTO env.ebh_potentiellt_fororenade_omraden (fid, geom)
      VALUES (999900, ST_Multi(ST_SetSRID(ST_MakePoint(591234, 6612345), 3006)))
    `);

    // 3. env.protected_area
    await client.query(`
      INSERT INTO env.protected_area (nvrid, namn, skyddstyp, geom)
      VALUES (
        'NVR-TEST-MAGIC',
        'Magic Protected Area',
        'Naturreservat',
        ST_Multi(ST_Buffer(ST_SetSRID(ST_MakePoint(591234, 6612345), 3006), 10))
      )
    `);

    await client.end();
  });

  afterAll(async () => {
    // Cleanup the seeded geometries
    const { Client } = await import("pg");
    const client = new Client({ connectionString: dbUrl });
    await client.connect();
    await client.query("DELETE FROM env.sgu_well WHERE id >= 999900");
    await client.query("DELETE FROM env.ebh_potentiellt_fororenade_omraden WHERE fid >= 999900");
    await client.query("DELETE FROM env.protected_area WHERE nvrid = 'NVR-TEST-MAGIC'");
    await client.end();

    await provider.close();
  });

  it("should go from project context and property to a verifiable LU assessment using real PostGIS evidence", async () => {
    // 1. Konsult skapar ett projekt (Project Context)
    const projectContext: LUProjectContextArtifact = {
      artifact_id: "art_ctx_001",
      artifact_type: "LU_PROJECT_CONTEXT",
      content_hash: { algorithm: "sha256", value: "hash_ctx_123" },
      references: [],
      payload: {
        project_name: "Ny industribyggnad Västerås",
        description: "Planerad etablering av produktionsanläggning",
        planned_activity: "Industriell verksamhet",
        property_refs: [],
        created_by: "Konsult A",
      }
    };

    await repo.put({
      artifact_id: projectContext.artifact_id,
      content_hash: projectContext.content_hash,
      body: projectContext,
    });

    // 2. Konsult anger fastighetsbeteckning (Property Context)
    const geomRef: ArtifactReference = { artifact_id: "geom_1", artifact_type: "CANONICAL_GEOMETRY" };
    
    const propertyContext: LUPropertyContextArtifact = {
      artifact_id: "art_prop_001",
      artifact_type: "LU_PROPERTY_CONTEXT",
      content_hash: { algorithm: "sha256", value: "hash_prop_123" },
      references: [geomRef],
      payload: {
        property_ref: "VÄSTERÅS 1:1",
        official_name: "Västerås 1:1",
        geometry_ref: geomRef,
        municipality: "Västerås",
        coordinates: [6612345, 591234],
      }
    };

    await repo.put({
      artifact_id: propertyContext.artifact_id,
      content_hash: propertyContext.content_hash,
      body: propertyContext,
    });

    const propRef: ArtifactReference = {
      artifact_id: propertyContext.artifact_id,
      artifact_type: propertyContext.artifact_type,
    };
    
    const projRef: ArtifactReference = {
      artifact_id: projectContext.artifact_id,
      artifact_type: projectContext.artifact_type,
    };

    // 3. Spatial Provider genererar Spatial Evidence från PostGIS
    const spatialEvidence = await provider.query({
      property_ref: propRef,
      buffer_distance_meters: 100,
      layers: [
        { name: "water", version_hash: "v1.0" },
        { name: "ebh", version_hash: "v1.0" },
        { name: "protected_area", version_hash: "v1.0" }
      ]
    });
    
    expect(spatialEvidence.length).toBeGreaterThanOrEqual(3);

    for (const ev of spatialEvidence) {
      expect(ev.payload.property_ref.artifact_id).toBe(propRef.artifact_id);
      expect(ev.content_hash.algorithm).toBe("sha256");
      expect(ev.content_hash.value).toMatch(/^[a-f0-9]{64}$/);
      const fromCas = await repo.resolve({ artifact_id: ev.artifact_id, artifact_type: ev.artifact_type });
      expect(fromCas).toBeDefined();
    }

    // Identity stability: same request → same content_hash (SV-I06)
    const again = await provider.query({
      property_ref: propRef,
      buffer_distance_meters: 100,
      layers: [
        { name: "water", version_hash: "v1.0" },
        { name: "ebh", version_hash: "v1.0" },
        { name: "protected_area", version_hash: "v1.0" },
      ],
    });
    expect(again.map((e) => e.content_hash.value).sort()).toEqual(
      spatialEvidence.map((e) => e.content_hash.value).sort(),
    );

    await expect(
      provider.query({
        property_ref: propRef,
        layers: Array.from({ length: 20 }, (_, i) => ({
          name: "water",
          version_hash: `v${i}`,
        })),
        budget: { max_layers: 3, max_features_per_layer: 10, max_distance_meters: 500, timeout_ms: 2000 },
      }),
    ).rejects.toThrow(/REJECT_SPATIAL_BUDGET/);

    // 4. ExecutionKernel admit → capability invoke → findings
    const kernelResult = await runLuAssessmentViaKernel({
      site_id: "magic-site",
      deterministic_seed: "seed:postgis-magic-moment",
      evidence: spatialEvidence,
    });
    
    expect(kernelResult.admitted).toBe(true);
    expect(kernelResult.attempt_id).toBeTruthy();
    expect(kernelResult.outcome_id).toBeTruthy();
    
    const findings = [...kernelResult.findings];

    // Beroende på regelmotorn, bör vi ha hittat "LU-WATER-001" och "LU-EBH-001" om vi har evidence.
    // LURuleEngine.ts i mps-lu bearbetar all spatial evidence och applicerar regler.
    const ruleIds = findings.map(f => f.rule_id);
    expect(ruleIds).toContain("LU-WATER-001");
    expect(ruleIds).toContain("LU-EBH-001");

    // 5. Systemet binder ihop allt till en LocalizationAssessmentArtifact
    const evidenceRefs = spatialEvidence.map(ev => ({
      artifact_id: ev.artifact_id,
      artifact_type: ev.artifact_type,
    }));

    const assessment: LocalizationAssessmentArtifact = {
      artifact_id: "art_assess_002",
      artifact_type: "LOCALIZATION_ASSESSMENT",
      content_hash: { algorithm: "sha256", value: "hash_assess_2" },
      references: [projRef, propRef, ...evidenceRefs],
      payload: {
        project_context_ref: projRef,
        property_ref: propRef,
        findings: findings,
        evidence_refs: evidenceRefs,
        rule_refs: findings.map(f => ({ rule_id: f.rule_id, rule_version: "1.0" })),
        system_summary: "Lokaliseringen påverkas av fynd genererade via PostGIS.",
      }
    };

    // Verifiera the Audit Graph & Findings
    expect(assessment.payload.evidence_refs.length).toBeGreaterThanOrEqual(3);
    expect(assessment.references.length).toBe(2 + assessment.payload.evidence_refs.length);
  });
});

