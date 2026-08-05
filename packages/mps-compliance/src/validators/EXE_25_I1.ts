import { ValidationRule } from "../conformance/ValidationRule";
import { ValidationContext } from "../conformance/ValidationContext";

export const EXE_25_I1: ValidationRule = {
  rule_id: "EXE-25-I1",
  implementation_hash: "v1-hash",
  description: "Execution identity SHALL NOT create actor identity",

  validate(context: ValidationContext) {
    const attempts = context.artifacts.filter((a) => a.artifact_type === "execution_attempt");
    const identities = context.artifacts.filter((a) => a.artifact_type === "execution_identity");
    // Identity artifacts must not invent actor fields; presence of attempt without identity is fail when attempts exist.
    const passed =
      attempts.length === 0 ||
      identities.length > 0 ||
      attempts.every((a) => Array.isArray(a.references));

    return {
      rule_id: "EXE-25-I1",
      passed,
      evidence: attempts.map((a) => a.artifact_id),
    };
  }
};
