import type { ContentHash } from "../../../../mps-compliance/src/artifacts/ContentHash.js";

/**
 * UI projection of an ExecutionKernel result — presentation only (ADR-27 Regel 3).
 */
export interface ExecutionResultViewModel {
  readonly admitted: boolean;
  readonly reason_codes: readonly string[];
  readonly attempt_id: string | null;
  readonly outcome_id: string | null;
  readonly capability_execution_ids: readonly string[];
  readonly content_hashes: readonly ContentHash[];
}

export function adaptExecutionKernelResult(input: {
  admitted: boolean;
  reason_codes: readonly string[];
  attempt_id: string | null;
  outcome_id: string | null;
  capability_execution_ids: readonly string[];
  content_hashes: readonly ContentHash[];
}): ExecutionResultViewModel {
  return {
    admitted: input.admitted,
    reason_codes: [...input.reason_codes],
    attempt_id: input.attempt_id,
    outcome_id: input.outcome_id,
    capability_execution_ids: [...input.capability_execution_ids],
    content_hashes: [...input.content_hashes],
  };
}
