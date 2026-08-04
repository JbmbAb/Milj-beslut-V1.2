import { describe, it, expect } from "vitest";
import { LUProjectContextPayload, LUProjectContextArtifact } from "../src/artifacts/LUProjectContextArtifact";
import { LUPropertyContextPayload, LUPropertyContextArtifact } from "../src/artifacts/LUPropertyContextArtifact";
import { SpatialEvidenceArtifact } from "../src/artifacts/SpatialEvidenceArtifact";
import { LocalizationAssessmentArtifact } from "../src/artifacts/LocalizationAssessmentArtifact";
import { LURuleEngine } from "../src/rules/LURuleEngine";
import { ArtifactReference } from "@miljobeslut/mps-compliance/artifacts/ArtifactContract";

describe("LU Domain - The Magic Moment", () => {
  it("should go from project context and property to a verifiable LU assessment", () => {
    // 1. Konsult skapar ett projekt (Project Context)
    const projectContext: LUProjectContextArtifact = {
      artifact_id: "art_ctx_001",
      artifact_type: "LU_PROJECT_CONTEXT",
      content_hash: "hash_ctx_123",
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
    const geomRef: ArtifactReference = { artifact_id: "geom_1", artifact_type: "CANONICAL_GEOMETRY", content_hash: "hash_geom" };
    
    const propertyContext: LUPropertyContextArtifact = {
      artifact_id: "art_prop_001",
      artifact_type: "LU_PROPERTY_CONTEXT",
      content_hash: "hash_prop_123",
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
      content_hash: propertyContext.content_hash,
    };
    
    const projRef: ArtifactReference = {
      artifact_id: projectContext.artifact_id,
      artifact_type: projectContext.artifact_type,
      content_hash: projectContext.content_hash,
    };

    // 3. Spatial Provider genererar Spatial Evidence
    const evidenceWater: SpatialEvidenceArtifact = {
      artifact_id: "art_ev_001",
      artifact_type: "SPATIAL_EVIDENCE",
      content_hash: "hash_ev_1",
      references: [propRef],
      payload: {
        canonical_geometry: { type: "Polygon", coordinates: [] },
        layer_ref: "layer_water",
        layer_version: "v2026",
        source_metadata: {
          provider: "Lantmäteriet",
          dataset: "water",
          dataset_version: "2026",
          retrieved_at: new Date().toISOString()
        },
        query_context: {
          property_ref: propRef,
          search_distance_meters: 100
        }
      }
    };

    const evidenceEbh: SpatialEvidenceArtifact = {
      artifact_id: "art_ev_002",
      artifact_type: "SPATIAL_EVIDENCE",
      content_hash: "hash_ev_2",
      references: [propRef],
      payload: {
        canonical_geometry: { type: "Polygon", coordinates: [] },
        layer_ref: "layer_ebh",
        layer_version: "v2026",
        source_metadata: {
          provider: "Naturvårdsverket",
          dataset: "ebh",
          dataset_version: "2026",
          retrieved_at: new Date().toISOString()
        },
        query_context: {
          property_ref: propRef,
          search_distance_meters: 100
        }
      }
    };

    const spatialEvidence = [evidenceWater, evidenceEbh];

    // 4. LURuleEngine utvärderar evidens till Findings
    const engine = new LURuleEngine();
    const findings = engine.evaluate(spatialEvidence);

    expect(findings.length).toBe(2);
    expect(findings[0].rule_id).toBe("LU-WATER-001");
    expect(findings[1].rule_id).toBe("LU-EBH-001");

    // 5. Systemet binder ihop allt till en LocalizationAssessmentArtifact
    const evidenceRefs = spatialEvidence.map(ev => ({
      artifact_id: ev.artifact_id,
      artifact_type: ev.artifact_type,
      content_hash: ev.content_hash,
    }));

    const assessment: LocalizationAssessmentArtifact = {
      artifact_id: "art_assess_001",
      artifact_type: "LOCALIZATION_ASSESSMENT",
      content_hash: "hash_assess_1",
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
