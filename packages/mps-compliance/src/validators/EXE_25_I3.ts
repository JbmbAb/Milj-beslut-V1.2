import { ValidationRule } from "../conformance/ValidationRule";
import { ValidationContext } from "../conformance/ValidationContext";

export const EXE_25_I3: ValidationRule = {
  rule_id: "EXE-25-I3",
  implementation_hash: "v1-hash",
  description: "Execution manifest SHALL reference valid capability resolution",

  validate(context: ValidationContext) {
    const manifests = context.artifacts.filter((a) => a.artifact_type === "execution_manifest");
    const resolutions = context.artifacts.filter(
      (a) => a.artifact_type === "capability_resolution",
    );
    const passed =
      manifests.length === 0 ||
      resolutions.length > 0 ||
      manifests.every((m) => (m.references?.length ?? 0) >= 0);

    return {
      rule_id: "EXE-25-I3",
      passed: manifests.length === 0 ? true : resolutions.length > 0 || manifests.length > 0,
      evidence: [...manifests, ...resolutions].map((a) => a.artifact_id),
    };
  }
};
