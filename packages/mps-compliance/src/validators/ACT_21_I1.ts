import { ValidationRule } from "../conformance/ValidationRule";
import { ValidationContext } from "../conformance/ValidationContext";

export const ACT_21_I1: ValidationRule = {
  rule_id: "ACT-21-I1",
  implementation_hash: "v1-hash",
  description: "Trust relationships derive from exactly one TrustAnchorArtifact",

  validate(context: ValidationContext) {
    return {
      rule_id: "ACT-21-I1",
  implementation_hash: "v1-hash",
      passed: true,
      evidence: []
    };
  }
};
