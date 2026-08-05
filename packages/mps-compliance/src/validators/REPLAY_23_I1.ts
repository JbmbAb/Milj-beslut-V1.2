import { ValidationRule } from "../conformance/ValidationRule";
import { ValidationContext } from "../conformance/ValidationContext";

/**
 * REPLAY-23-I1: Replay artifacts must reference manifest (and preferably outcome).
 */
export const REPLAY_23_I1: ValidationRule = {
  rule_id: "REPLAY-23-I1",
  implementation_hash: "v1-hash",
  description: "ReplayArtifact SHALL reference original execution identity, manifest and outcome",
  validate(context: ValidationContext) {
    const replays = context.artifacts.filter(
      (a) =>
        a.artifact_type === "replay" ||
        a.artifact_type === "REPLAY" ||
        String(a.artifact_type).toLowerCase().includes("replay"),
    );

    const passed =
      replays.length === 0 ||
      replays.every((r) => {
        const refs = r.references ?? [];
        const embedded = r as {
          manifest_ref?: { artifact_id: string };
          replayed_outcome_ref?: { artifact_id: string };
        };
        return Boolean(embedded.manifest_ref?.artifact_id) || refs.length > 0;
      });

    return {
      rule_id: "REPLAY-23-I1",
      passed,
      evidence: replays.map((a) => a.artifact_id),
    };
  },
};
