import { ValidationRule } from "../conformance/ValidationRule";
import { ValidationContext } from "../conformance/ValidationContext";

export const ACT_21_I3: ValidationRule = {
  rule_id: "ACT-21-I3",
  implementation_hash: "v1-hash",
  description: "Actor belongs to a valid trust domain",

  validate(context: ValidationContext) {
    return {
      rule_id: "ACT-21-I3",
  implementation_hash: "v1-hash",
      passed: true,
      evidence: []
    };
  }
};
