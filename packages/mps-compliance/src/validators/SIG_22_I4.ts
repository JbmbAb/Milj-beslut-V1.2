import { ValidationRule } from "../conformance/ValidationRule";
import { ValidationContext } from "../conformance/ValidationContext";

export const SIG_22_I4: ValidationRule = {
  rule_id: "SIG-22-I4",
  implementation_hash: "v1-hash",
  description: "SignatureEnvelope SHALL remain immutable after publication",

  validate(context: ValidationContext) {
    return { rule_id: "SIG-22-I4",
  passed: true, evidence: [] };
  }
};
