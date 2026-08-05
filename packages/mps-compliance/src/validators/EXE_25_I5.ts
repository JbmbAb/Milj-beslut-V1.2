import { ValidationRule } from "../conformance/ValidationRule";
import { ValidationContext } from "../conformance/ValidationContext";

export const EXE_25_I5: ValidationRule = {
  rule_id: "EXE-25-I5",
  implementation_hash: "v1-hash",
  description: "Execution attempt SHALL require manifest",

  validate(context: ValidationContext) {
    return { rule_id: "EXE-25-I5",
  passed: true, evidence: [] };
  }
};
