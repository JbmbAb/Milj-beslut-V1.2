import { describe, it, expect } from "vitest";
import { LUProjectContextPayload, LUProjectContextArtifact } from "../src/artifacts/LUProjectContextArtifact";
import { LUPropertyContextPayload, LUPropertyContextArtifact } from "../src/artifacts/LUPropertyContextArtifact";
import { SpatialEvidenceArtifact } from "../src/artifacts/SpatialEvidenceArtifact";
import { LocalizationAssessmentArtifact } from "../src/artifacts/LocalizationAssessmentArtifact";
import { runLuAssessmentViaKernel } from "../src/execution/LuExecutionKernelClient";
import { ArtifactReference } from "@miljobeslut/mps-compliance/src/artifacts/ArtifactContract";

describe("LU Domain - The Magic Moment", () => {
  it("should go from project context and property to a verifiable LU assessment", async () => {
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

    // 3. Spatial Provider genererar Spatial Evidence
    const evidenceWater: SpatialEvidenceArtifact = {
      artifact_id: "art_ev_001",
      artifact_type: "SPATIAL_EVIDENCE",
      content_hash: { algorithm: "sha256", value: "hash_ev_1" },
      references: [propRef],
      payload: {
        property_ref: propRef,
        geometry: { type: "Polygon", coordinates: [] },
        layer_ref: { layer_id: "layer_water", layer_version: "v2026" },
        source_metadata: {
          provider: "Lantmäteriet",
          dataset: "water",
          dataset_version: "2026",
          retrieved_at: new Date().toISOString()
        },
        query_context: {
          query_id: "query-water",
          query_type: "SPATIAL_INTERSECTION",
          parameters: {
            property_ref: propRef,
            search_distance_meters: 100
          }
        }
      }
    };

    const evidenceEbh: SpatialEvidenceArtifact = {
      artifact_id: "art_ev_002",
      artifact_type: "SPATIAL_EVIDENCE",
      content_hash: { algorithm: "sha256", value: "hash_ev_2" },
      references: [propRef],
      payload: {
        property_ref: propRef,
        geometry: { type: "Polygon", coordinates: [] },
        layer_ref: { layer_id: "layer_ebh", layer_version: "v2026" },
        source_metadata: {
          provider: "Naturvårdsverket",
          dataset: "ebh",
          dataset_version: "2026",
          retrieved_at: new Date().toISOString()
        },
        query_context: {
          query_id: "query-ebh",
          query_type: "SPATIAL_INTERSECTION",
          parameters: {
            property_ref: propRef,
            search_distance_meters: 100
          }
        }
      }
    };

    const spatialEvidence = [evidenceWater, evidenceEbh];

    // 4. ExecutionKernel admit → capability invoke → findings (enda produktväg)
    const kernelResult = await runLuAssessmentViaKernel({
      site_id: "magic-site",
      deterministic_seed: "seed:magic-moment",
      evidence: spatialEvidence,
    });
    expect(kernelResult.admitted).toBe(true);
    expect(kernelResult.attempt_id).toBeTruthy();
    expect(kernelResult.outcome_id).toBeTruthy();
    const findings = [...kernelResult.findings];

    expect(findings.length).toBe(2);
    expect(findings[0].rule_id).toBe("LU-WATER-001");
    expect(findings[1].rule_id).toBe("LU-EBH-001");

    // 5. Systemet binder ihop allt till en LocalizationAssessmentArtifact
    const evidenceRefs = spatialEvidence.map(ev => ({
      artifact_id: ev.artifact_id,
      artifact_type: ev.artifact_type,
    }));

    const assessment: LocalizationAssessmentArtifact = {
      artifact_id: "art_assess_001",
      artifact_type: "LOCALIZATION_ASSESSMENT",
      content_hash: { algorithm: "sha256", value: "hash_assess_1" },
      references: [projRef, propRef, ...evidenceRefs],
      payload: {
        project_context_ref: projRef,
        property_ref: propRef,
        findings: findings,
        evidence_refs: evidenceRefs,
        rule_refs: [
          { rule_id: "LU-WATER-001", rule_version: "1.0" },
          { rule_id: "LU-EBH-001", rule_version: "1.0" }
        ],
        system_summary: "Lokaliseringen påverkas av närliggande vatten och potentiell förorening.",
      }
    };

    // Verifiera the Audit Graph & Findings
    expect(assessment.payload.findings).toHaveLength(2);
    expect(assessment.payload.evidence_refs).toHaveLength(2);
    expect(assessment.references.length).toBe(4); // proj, prop, ev1, ev2
  });
});
