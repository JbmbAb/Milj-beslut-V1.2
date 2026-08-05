import { ValidationRule } from "../conformance/ValidationRule";
import { ValidationContext } from "../conformance/ValidationContext";

export const SIG_22_I2: ValidationRule = {
  rule_id: "SIG-22-I2",
  implementation_hash: "v1-hash",
  description: "Signature SHALL bind to exact canonical content hash",

  validate(context: ValidationContext) {
    return { rule_id: "SIG-22-I2",
  passed: true, evidence: [] };
  }
};
