import { ValidationProfileSnapshot } from "../conformance/ValidationProfileSnapshot";

/**
 * Single ADR conformance binding.
 *
 * Maps semantic authority to executable validation.
 */
export interface ConformanceEntry {
  readonly adr_id: string;
  readonly profile: ValidationProfileSnapshot;
}
