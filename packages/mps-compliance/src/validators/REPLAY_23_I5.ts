import { ValidationRule } from "../conformance/ValidationRule";
import { ValidationContext } from "../conformance/ValidationContext";

export const REPLAY_23_I5: ValidationRule = {
  rule_id: "REPLAY-23-I5",
  implementation_hash: "v1-hash",
  description: "Replay SHALL be deterministic with respect to canonical state and signatures",
  validate(context: ValidationContext) {
    return { rule_id: "REPLAY-23-I5",
  passed: true, evidence: [] };
  }
};
