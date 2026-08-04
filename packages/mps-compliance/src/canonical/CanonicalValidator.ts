import { CanonicalBytes } from "./CanonicalBytes";
import { CanonicalRules } from "./CanonicalRules";

/**
 * Validates that CanonicalBytes conform to CanonicalRules.
 */
export interface CanonicalValidator {
  /**
   * Returns true if the given bytes conform to the canonical rules.
   */
  validate(bytes: CanonicalBytes, rules: CanonicalRules): boolean;
}
