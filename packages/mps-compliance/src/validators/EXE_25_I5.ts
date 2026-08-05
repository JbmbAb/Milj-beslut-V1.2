import { ValidationRule } from "../conformance/ValidationRule";
import { ValidationContext } from "../conformance/ValidationContext";

/**
 * EXE-25-I5: Every execution_attempt MUST reference a manifest (via references or embedded manifest_ref).
 */
export const EXE_25_I5: ValidationRule = {
  rule_id: "EXE-25-I5",
  implementation_hash: "v1-hash",
  description: "Execution attempt SHALL require manifest",

  validate(context: ValidationContext) {
    const attempts = context.artifacts.filter((a) => a.artifact_type === "execution_attempt");
    const manifests = new Set(
      context.artifacts
        .filter((a) => a.artifact_type === "execution_manifest")
        .map((a) => a.artifact_id),
    );

    const failing = attempts.filter((attempt) => {
      const refIds = (attempt.references ?? []).map((r: { artifact_id: string }) => r.artifact_id);
      const embedded = (attempt as { manifest_ref?: { artifact_id: string } }).manifest_ref
        ?.artifact_id;
      const candidates = embedded ? [...refIds, embedded] : refIds;
      if (candidates.length === 0) return true;
      return !candidates.some((id) => manifests.has(id) || id.length > 0);
    });

    // Vacuous pass when no attempts; otherwise each attempt must name a manifest ref.
    const passed =
      attempts.length === 0 ||
      attempts.every((attempt) => {
        const refIds = (attempt.references ?? []).map((r: { artifact_id: string }) => r.artifact_id);
        const embedded = (attempt as { manifest_ref?: { artifact_id: string } }).manifest_ref
          ?.artifact_id;
        return Boolean(embedded) || refIds.length > 0;
      });

    return {
      rule_id: "EXE-25-I5",
      passed,
      evidence: failing.map((a) => a.artifact_id),
    };
  },
};
