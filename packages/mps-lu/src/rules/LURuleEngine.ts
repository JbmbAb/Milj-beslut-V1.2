import { SpatialEvidenceArtifact } from "../artifacts/SpatialEvidenceArtifact";
import { AssessmentFinding } from "../domain/AssessmentFinding";
import { ArtifactReference } from "@miljobeslut/mps-compliance/src/artifacts/ArtifactContract";

export class LURuleEngine {
  evaluate(evidence: SpatialEvidenceArtifact[]): AssessmentFinding[] {
    const findings: AssessmentFinding[] = [];

    for (const ev of evidence) {
      const layer = ev.payload.source_metadata.dataset;
      
      if (layer === "water") {
        // Mock distance extraction or rule evaluation
        const finding: AssessmentFinding = {
          finding_id: `finding-water-${ev.artifact_id}`,
          rule_id: "LU-WATER-001",
          rule_version: "1.0",
          explanation: "Närhet till vatten kräver analys",
          risk_level: "MEDIUM",
          evidence_refs: [this.toRef(ev)],
        };
        findings.push(finding);
      }
      
      if (layer === "ebh") {
        const finding: AssessmentFinding = {
          finding_id: `finding-ebh-${ev.artifact_id}`,
          rule_id: "LU-EBH-001",
          rule_version: "1.0",
          explanation: "Potentiellt förorenat område inom sökradie",
          risk_level: "HIGH",
          evidence_refs: [this.toRef(ev)],
        };
        findings.push(finding);
      }
      
      if (layer === "protected_area") {
        const finding: AssessmentFinding = {
          finding_id: `finding-protected-${ev.artifact_id}`,
          rule_id: "LU-PROTECTED-001",
          rule_version: "1.0",
          explanation: "Skyddat naturområde påverkas av lokaliseringen",
          risk_level: "MEDIUM",
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
    };
  }
}
