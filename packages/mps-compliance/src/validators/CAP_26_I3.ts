import { ValidationRule } from "../conformance/ValidationRule";
import { ValidationContext } from "../conformance/ValidationContext";
import { ValidationResult } from "../conformance/ValidationResult";

/**
 * CAP-26-I3: Capability grants/scopes must reference a scope when grant-like artifacts exist.
 */
export const CAP_26_I3: ValidationRule = {
  rule_id: "CAP-26-I3",
  implementation_hash: "v1-hash",
  description: "CapabilityGrant SHALL reference valid CapabilityScopeArtifact",

  validate(context: ValidationContext): ValidationResult {
    const grants = context.artifacts.filter(
      (a) =>
        a.artifact_type === "capability_grant" ||
        String(a.artifact_type).toLowerCase().includes("grant"),
    );

    const passed =
      grants.length === 0 ||
      grants.every((g) => {
        const scope = (g as { scope_ref?: { artifact_id: string } }).scope_ref?.artifact_id;
        const refs = g.references ?? [];
        return Boolean(scope) || refs.length > 0;
      });

    return {
      rule_id: "CAP-26-I3",
      passed,
      evidence: grants.map((a) => a.artifact_id),
    };
  },
};
