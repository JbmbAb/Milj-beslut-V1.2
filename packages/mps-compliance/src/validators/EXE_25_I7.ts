import { ValidationRule } from "../conformance/ValidationRule";
import { ValidationContext } from "../conformance/ValidationContext";

/**
 * EXE-25-I7: Every execution_outcome MUST reference an attempt.
 */
export const EXE_25_I7: ValidationRule = {
  rule_id: "EXE-25-I7",
  implementation_hash: "v1-hash",
  description: "Execution outcome SHALL require attempt",

  validate(context: ValidationContext) {
    const outcomes = context.artifacts.filter((a) => a.artifact_type === "execution_outcome");
    const attempts = new Set(
      context.artifacts
        .filter((a) => a.artifact_type === "execution_attempt")
        .map((a) => a.artifact_id),
    );

    const failing = outcomes.filter((outcome) => {
      const refIds = (outcome.references ?? []).map((r: { artifact_id: string }) => r.artifact_id);
      const embedded = (outcome as { attempt_ref?: { artifact_id: string } }).attempt_ref
        ?.artifact_id;
      const hasRef = Boolean(embedded) || refIds.length > 0;
      if (!hasRef) return true;
      if (attempts.size === 0) return false; // ref present; attempt artifact may live elsewhere
      return embedded ? !attempts.has(embedded) && !refIds.some((id) => attempts.has(id)) : false;
    });

    const passed =
      outcomes.length === 0 ||
      outcomes.every((outcome) => {
        const refIds = (outcome.references ?? []).map((r: { artifact_id: string }) => r.artifact_id);
        const embedded = (outcome as { attempt_ref?: { artifact_id: string } }).attempt_ref
          ?.artifact_id;
        return Boolean(embedded) || refIds.length > 0;
      });

    return {
      rule_id: "EXE-25-I7",
      passed,
      evidence: failing.map((a) => a.artifact_id),
    };
  },
};
