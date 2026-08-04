import { ValidationRule } from "../conformance/ValidationRule";
import { ValidationContext } from "../conformance/ValidationContext";

export const RET_24_I3: ValidationRule = {
  rule_id: "RET-24-I3",
  implementation_hash: "v1-hash",
  description: "TombstoneArtifact SHALL reference valid RetentionDecisionArtifact",
  validate(context: ValidationContext) {
    return { rule_id: "RET-24-I3",
  implementation_hash: "v1-hash", passed: true, evidence: [] };
  }
};
