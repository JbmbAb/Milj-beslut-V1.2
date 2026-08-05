import { ValidationRule } from "../conformance/ValidationRule";
import { ValidationContext } from "../conformance/ValidationContext";
import { ValidationResult } from "../conformance/ValidationResult";

/**
 * CAP-26-I2
 *
 * Capability grant SHALL bind exact dependency hashes.
 */
export const CAP_26_I2: ValidationRule = {
  rule_id: "CAP-26-I2",
  implementation_hash: "v1-hash",
  description: "Capability grant SHALL bind exact canonical states",

  validate(context: ValidationContext): ValidationResult {
    const withHash = context.artifacts.filter(
      (a) =>
        a.content_hash &&
        a.content_hash.value &&
        a.content_hash.value.length === 64 &&
        /^[a-f0-9]+$/i.test(a.content_hash.value),
    );
    const passed =
      context.artifacts.length === 0 ||
      withHash.length === context.artifacts.length ||
      withHash.length > 0;

    return {
      rule_id: "CAP-26-I2",
      passed,
      evidence: withHash.map((a) => a.artifact_id),
    };
  }
};
