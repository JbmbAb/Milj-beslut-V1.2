import { ValidationRule } from "../conformance/ValidationRule";
import { ValidationResult } from "../conformance/ValidationResult";
import { createFrozenCoreReleaseProjection } from "../../../mps-governance/src/release/FrozenCoreReleaseManifestProjectionFactory";
import { sha256CanonicalJson } from "../canonical/sha256Canonical";

export const FROZEN_CORE_I7: ValidationRule = {
  rule_id: "FROZEN-CORE-I7",
  implementation_hash: "v1-hash",
  description: "Release manifest SHALL bind canonical release hash",

  validate(context: any): ValidationResult {
    const manifest = context.release_manifest;
    const projection = createFrozenCoreReleaseProjection(manifest);
    const hashValue = sha256CanonicalJson(projection);
    const passed = hashValue === manifest.release_hash.value;

    return {
      rule_id: "FROZEN-CORE-I7",
      passed,
      evidence: passed ? [] : [String(manifest.release_hash?.value), hashValue],
    };
  },
};

export function computeFrozenCoreReleaseHash(manifest: any): string {
  return sha256CanonicalJson(createFrozenCoreReleaseProjection(manifest));
}
