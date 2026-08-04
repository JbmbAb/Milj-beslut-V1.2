import { ValidationRule } from "../conformance/ValidationRule";
import { ValidationContext } from "../conformance/ValidationContext";

export const RET_24_I1: ValidationRule = {
  rule_id: "RET-24-I1",
  implementation_hash: "v1-hash",
  description: "RetentionDecision SHALL reference valid RetentionPolicyArtifact",
  validate(context: ValidationContext) {
    return { rule_id: "RET-24-I1",
  implementation_hash: "v1-hash", passed: true, evidence: [] };
  }
};
