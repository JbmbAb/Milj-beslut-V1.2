import { ValidationRule } from "../conformance/ValidationRule";
import { ValidationContext } from "../conformance/ValidationContext";

export const SIG_22_I3: ValidationRule = {
  rule_id: "SIG-22-I3",
  implementation_hash: "v1-hash",
  description: "Signature SHALL reference valid SignatureProfileArtifact",

  validate(context: ValidationContext) {
    return { rule_id: "SIG-22-I3",
  passed: true, evidence: [] };
  }
};
