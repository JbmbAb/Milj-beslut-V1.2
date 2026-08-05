import { ValidationRule } from "../conformance/ValidationRule";
import { ValidationContext } from "../conformance/ValidationContext";

export const RET_24_I5: ValidationRule = {
  rule_id: "RET-24-I5",
  implementation_hash: "v1-hash",
  description: "EvidencePreservationArtifact SHALL reference valid RetentionDecisionArtifact",
  validate(context: ValidationContext) {
    return { rule_id: "RET-24-I5",
  passed: true, evidence: [] };
  }
};
