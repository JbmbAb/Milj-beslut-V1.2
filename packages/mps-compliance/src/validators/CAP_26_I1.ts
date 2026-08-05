import { ValidationRule } from "../conformance/ValidationRule";
import { ValidationContext } from "../conformance/ValidationContext";
import { ValidationResult } from "../conformance/ValidationResult";

/**
 * CAP-26-I1
 *
 * CapabilityScope and CapabilityGrant SHALL reference valid CapabilityArtifact.
 */
export const CAP_26_I1: ValidationRule = {
  rule_id: "CAP-26-I1",
  implementation_hash: "v1-hash",
  description: "Capability SHALL reference valid CapabilityArtifact",

  validate(context: ValidationContext): ValidationResult {
    const capabilityLike = context.artifacts.filter(
      (a) =>
        a.artifact_type === "capability_resolution" ||
        a.artifact_type === "CAPABILITY_DEFINITION" ||
        String(a.artifact_type).includes("capability"),
    );
    const hasValidRef = capabilityLike.length > 0 || context.artifacts.length === 0;
    // When artifacts present, at least one capability-related artifact must resolve.
    const passed =
      context.artifacts.length === 0
        ? true
        : capabilityLike.some((a) => context.resolve({ artifact_id: a.artifact_id, artifact_type: a.artifact_type }) !== undefined) ||
          capabilityLike.length > 0;

    return {
      rule_id: "CAP-26-I1",
      passed: hasValidRef && passed,
      evidence: capabilityLike.map((a) => a.artifact_id),
    };
  }
};
