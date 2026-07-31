export type ReplayMismatchKind =
  | "EXECUTION_IDENTITY_HASH"
  | "EXECUTION_PLAN_HASH"
  | "DEPENDENCY_GRAPH_HASH"
  | "DETERMINISTIC_SEED"
  | "COMPLETED_STEPS"
  | "OUTPUT_ARTIFACTS";

export interface ReplayMismatch {
  readonly kind: ReplayMismatchKind;
  readonly details: string;
}

import { ReplayInvariantResult } from "./ReplayInvariant";

export interface ReplayVerificationResult {
  readonly replay_valid: boolean;
  readonly fingerprint_valid: boolean;
  readonly invariant_results: readonly ReplayInvariantResult[];
  readonly mismatches: readonly ReplayMismatch[];
}
