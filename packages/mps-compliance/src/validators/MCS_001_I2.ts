import { ValidationRule } from "../conformance/ValidationRule";
import { ValidationResult } from "../conformance/ValidationResult";
import { createConformanceMatrixProjection } from "../matrix/ConformanceMatrixProjectionFactory";
import { sha256CanonicalJson } from "../canonical/sha256Canonical";

export const MCS_001_I2: ValidationRule = {
  rule_id: "MCS-001-I2",
  implementation_hash: "v1-hash",
  description: "Matrix identity SHALL bind to canonical matrix state",

  validate(context: any): ValidationResult {
    const matrix = context.matrix;
    const projection = createConformanceMatrixProjection(matrix);
    const hashValue = sha256CanonicalJson(projection);
    const passed = hashValue === matrix.identity.content_hash.value;

    return {
      rule_id: "MCS-001-I2",
      passed,
      evidence: passed ? [] : [String(matrix.identity?.content_hash?.value), hashValue],
    };
  },
};
