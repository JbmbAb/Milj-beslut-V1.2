import { ArtifactReference } from "@miljobeslut/mps-compliance/artifacts/ArtifactContract";

export type RuleId = string;
export type RuleVersion = string;

export interface AssessmentFinding {
  finding_id: string;
  rule_id: RuleId;
  rule_version: RuleVersion;
  risk_level: "LOW" | "MEDIUM" | "HIGH";
  evidence_refs: readonly ArtifactReference[];
  explanation: string;
}
