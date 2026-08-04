import { SpatialEvidenceArtifact } from "../artifacts/SpatialEvidenceArtifact";
import { AssessmentFinding } from "../domain/AssessmentFinding";
import { ArtifactReference } from "@miljobeslut/mps-compliance/artifacts/ArtifactContract";

export class LURuleEngine {
  evaluate(evidence: SpatialEvidenceArtifact[]): AssessmentFinding[] {
    const findings: AssessmentFinding[] = [];

    for (const ev of evidence) {
      const layer = ev.payload.source_metadata.dataset;
      
      if (layer === "water") {
        // Mock distance extraction or rule evaluation
        const finding: AssessmentFinding = {
          rule_id: "LU-WATER-001",
          rule_version: "1.0",
          description: "Närhet till vatten kräver analys",
          severity: "MEDIUM",
          evidence_refs: [this.toRef(ev)],
        };
        findings.push(finding);
      }
      
      if (layer === "ebh") {
        const finding: AssessmentFinding = {
          rule_id: "LU-EBH-001",
          rule_version: "1.0",
          description: "Potentiellt förorenat område inom sökradie",
          severity: "HIGH",
          evidence_refs: [this.toRef(ev)],
        };
        findings.push(finding);
      }
      
      if (layer === "protected_area") {
        const finding: AssessmentFinding = {
          rule_id: "LU-PROTECTED-001",
          rule_version: "1.0",
          description: "Skyddat naturområde påverkas av lokaliseringen",
          severity: "MEDIUM",
          evidence_refs: [this.toRef(ev)],
        };
        findings.push(finding);
      }
    }

    return findings;
  }
  
  private toRef(artifact: SpatialEvidenceArtifact): ArtifactReference {
    return {
      artifact_id: artifact.artifact_id,
      artifact_type: artifact.artifact_type,
      content_hash: artifact.content_hash,
    };
  }
}
