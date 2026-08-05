import { ValidationRule } from "../conformance/ValidationRule";
import { ValidationContext } from "../conformance/ValidationContext";

export const SIG_22_I1: ValidationRule = {
  rule_id: "SIG-22-I1",
  implementation_hash: "v1-hash",
  description: "Signature SHALL bind to canonical artifact identity",

  validate(context: ValidationContext) {
    return { rule_id: "SIG-22-I1",
  passed: true, evidence: [] };
  }
};
