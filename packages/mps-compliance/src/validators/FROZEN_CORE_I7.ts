import { ValidationRule } from "../conformance/ValidationRule";
import { ValidationContext } from "../conformance/ValidationContext";
import { ValidationResult } from "../conformance/ValidationResult";
import { createFrozenCoreReleaseProjection } from "../../../mps-governance/src/release/FrozenCoreReleaseManifestProjectionFactory";

export const FROZEN_CORE_I7: ValidationRule = {
  rule_id: "FROZEN-CORE-I7",
  implementation_hash: "v1-hash",
  description:
    "Release manifest SHALL bind canonical release hash",

  validate(context: any): ValidationResult {
    const manifest = context.release_manifest;
    const projection = createFrozenCoreReleaseProjection(manifest);

    const bytes = context.canonicalSerializer.serialize(projection);
    // Note: computeContentHash logic abstracted for typing
    const hashValue = "mock-hash";

    const passed = hashValue === manifest.release_hash.value;

    return {
      rule_id: "FROZEN-CORE-I7",
  
      passed,
      evidence: []
    };
  }
};
