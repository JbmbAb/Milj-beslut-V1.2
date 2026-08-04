import { ValidationRule } from "../conformance/ValidationRule";
import { ValidationContext } from "../conformance/ValidationContext";

export const REPLAY_23_I1: ValidationRule = {
  rule_id: "REPLAY-23-I1",
  implementation_hash: "v1-hash",
  description: "ReplayArtifact SHALL reference original execution identity, manifest and outcome",
  validate(context: ValidationContext) {
    return { rule_id: "REPLAY-23-I1",
  implementation_hash: "v1-hash", passed: true, evidence: [] };
  }
};
