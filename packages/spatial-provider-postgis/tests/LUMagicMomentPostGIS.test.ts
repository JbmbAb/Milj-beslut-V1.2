import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { SpatialProviderPostGIS } from "../src/SpatialProviderPostGIS";
import { LUProjectContextArtifact } from "@miljobeslut/mps-lu";
import { LUPropertyContextArtifact } from "@miljobeslut/mps-lu";
import { LocalizationAssessmentArtifact } from "@miljobeslut/mps-lu";
import { runLuAssessmentViaKernel } from "@miljobeslut/mps-lu";
import { ArtifactReference } from "@miljobeslut/mps-compliance/artifacts/ArtifactContract";
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
  });

  afterAll(async () => {
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
    
    // Vi borde ha fått åtminstone "water", "ebh" och "protected_area" tillbaka baserat på vår mock query
    expect(spatialEvidence.length).toBeGreaterThanOrEqual(3);

    // Verifiera att de ligger i CAS!
    for (const ev of spatialEvidence) {
      const fromCas = await repo.resolve({ artifact_id: ev.artifact_id, artifact_type: ev.artifact_type });
      expect(fromCas).toBeDefined();
    }

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
