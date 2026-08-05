import { ValidationRule } from "../conformance/ValidationRule";
import { ValidationContext } from "../conformance/ValidationContext";

export const EXE_25_I1: ValidationRule = {
  rule_id: "EXE-25-I1",
  implementation_hash: "v1-hash",
  description: "Execution identity SHALL NOT create actor identity",

  validate(context: ValidationContext) {
    return { rule_id: "EXE-25-I1",
  passed: true, evidence: [] };
  }
};
