import { ValidationContext } from "./ValidationContext";
import { ValidationResult } from "./ValidationResult";

/**
 * Pure validation rule.
 */
export interface ValidationRule {
  readonly rule_id: string;
  readonly implementation_hash: string;
  readonly description?: string;
  validate(context: ValidationContext): ValidationResult;
}
