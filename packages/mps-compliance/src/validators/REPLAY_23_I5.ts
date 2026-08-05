import { ValidationRule } from "../conformance/ValidationRule";
import { ValidationContext } from "../conformance/ValidationContext";

/**
 * REPLAY-23-I5: Replayed outcome ref must be named when replay exists.
 */
export const REPLAY_23_I5: ValidationRule = {
  rule_id: "REPLAY-23-I5",
  implementation_hash: "v1-hash",
  description: "ReplayArtifact SHALL reference replayed outcome",
  validate(context: ValidationContext) {
    const replays = context.artifacts.filter(
      (a) =>
        a.artifact_type === "replay" ||
        String(a.artifact_type).toLowerCase().includes("replay"),
    );

    const passed =
      replays.length === 0 ||
      replays.every((r) => {
        const embedded = (r as { replayed_outcome_ref?: { artifact_id: string } })
          .replayed_outcome_ref?.artifact_id;
        const refs = (r.references ?? []).map((x: { artifact_id: string }) => x.artifact_id);
        return Boolean(embedded) || refs.length > 0;
      });

    return {
      rule_id: "REPLAY-23-I5",
      passed,
      evidence: replays.map((a) => a.artifact_id),
    };
  },
};
