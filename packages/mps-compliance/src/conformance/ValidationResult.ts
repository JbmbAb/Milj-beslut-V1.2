import { ValidationEvidence } from "./ValidationEvidence";

/**
 * Deterministic validation result.
 *
 * Evidence references MAY later participate in closure resolution
 * by replay/audit layers.
 */
export interface ValidationResult {
  readonly rule_id: string;
  readonly passed: boolean;
  readonly evidence: readonly ValidationEvidence[];
}
