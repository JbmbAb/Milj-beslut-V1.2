import { ArtifactReference } from "@miljobeslut/mps-compliance/src/artifacts/ArtifactContract";

export type RuleId = string;
export type RuleVersion = string;

/**
 * SEM-1 (ADR-28A section 1) -- "the system SHALL distinguish 'checked and absent' from 'could
 * not be checked'. UNKNOWN/NOT_CHECKED is a non-severity state." `NOT_CHECKED` is that state: a
 * rule whose required evidence could not be technically obtained emits a `NOT_CHECKED` finding
 * instead of staying silent (which would read identically to "checked, nothing found") or
 * denying the whole assessment. It carries no severity and must never be treated as LOW by a
 * verdict projection that only looks for HIGH/MEDIUM findings.
 */
export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "NOT_CHECKED";

export interface AssessmentFinding {
  finding_id: string;
  rule_id: RuleId;
  rule_version: RuleVersion;
  risk_level: RiskLevel;
  evidence_refs: readonly ArtifactReference[];
  explanation: string;
}
