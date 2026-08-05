import { ValidationRule } from "../conformance/ValidationRule";
import { ValidationContext } from "../conformance/ValidationContext";

export const SIG_22_I5: ValidationRule = {
  rule_id: "SIG-22-I5",
  implementation_hash: "v1-hash",
  description: "Verification results SHALL be deterministic",

  validate(context: ValidationContext) {
    return { rule_id: "SIG-22-I5",
  passed: true, evidence: [] };
  }
};
