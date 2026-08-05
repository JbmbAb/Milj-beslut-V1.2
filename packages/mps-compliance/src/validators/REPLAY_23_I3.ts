import { ValidationRule } from "../conformance/ValidationRule";
import { ValidationContext } from "../conformance/ValidationContext";

/**
 * REPLAY-23-I3: Replay equivalence proof must be present when replay artifacts exist.
 */
export const REPLAY_23_I3: ValidationRule = {
  rule_id: "REPLAY-23-I3",
  implementation_hash: "v1-hash",
  description: "Replay SHALL carry equivalence proof when replay artifact is present",
  validate(context: ValidationContext) {
    const replays = context.artifacts.filter(
      (a) =>
        a.artifact_type === "replay" ||
        String(a.artifact_type).toLowerCase().includes("replay"),
    );

    const failing = replays.filter((r) => {
      const proof = (r as { equivalence_proof?: unknown }).equivalence_proof;
      return proof === undefined || proof === null;
    });

    return {
      rule_id: "REPLAY-23-I3",
      passed: failing.length === 0,
      evidence: failing.map((a) => a.artifact_id),
    };
  },
};
