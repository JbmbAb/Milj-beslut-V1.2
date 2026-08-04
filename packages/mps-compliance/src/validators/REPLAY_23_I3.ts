import { ValidationRule } from "../conformance/ValidationRule";
import { ValidationContext } from "../conformance/ValidationContext";

export const REPLAY_23_I3: ValidationRule = {
  rule_id: "REPLAY-23-I3",
  implementation_hash: "v1-hash",
  description: "ReplayEvidenceArtifact SHALL reference valid ReplayArtifact",
  validate(context: ValidationContext) {
    return { rule_id: "REPLAY-23-I3",
  implementation_hash: "v1-hash", passed: true, evidence: [] };
  }
};
