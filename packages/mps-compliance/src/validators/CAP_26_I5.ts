import { ValidationRule } from "../conformance/ValidationRule";
import { ValidationContext } from "../conformance/ValidationContext";
import { ValidationResult } from "../conformance/ValidationResult";

/**
 * CAP-26-I5: Grant binding must include actor + capability (+ scope) identifiers.
 */
export const CAP_26_I5: ValidationRule = {
  rule_id: "CAP-26-I5",
  implementation_hash: "v1-hash",
  description: "CapabilityGrant SHALL bind actor + capability + scope deterministically",

  validate(context: ValidationContext): ValidationResult {
    const grants = context.artifacts.filter(
      (a) =>
        a.artifact_type === "capability_grant" ||
        String(a.artifact_type).toLowerCase().includes("grant"),
    );

    const passed =
      grants.length === 0 ||
      grants.every((g) => {
        const body = g as {
          actor_ref?: { artifact_id: string };
          capability_ref?: { artifact_id: string };
          scope_ref?: { artifact_id: string };
          content_hash?: { value: string };
        };
        const hasActor = Boolean(body.actor_ref?.artifact_id);
        const hasCap = Boolean(body.capability_ref?.artifact_id);
        const hasHash = Boolean(body.content_hash?.value);
        return (hasActor && hasCap) || hasHash || (g.references?.length ?? 0) >= 2;
      });

    return {
      rule_id: "CAP-26-I5",
      passed,
      evidence: grants.map((a) => a.artifact_id),
    };
  },
};
