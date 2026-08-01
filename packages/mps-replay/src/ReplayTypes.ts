import type {
  ContentReference,
  VerificationResult,
} from "@miljobeslut/mps-core";

export type ReplayStage =
  | "GOVERNANCE"
  | "ARCHIVE"
  | "PROMOTION";

export interface ReplayTarget {
  readonly stage: ReplayStage;
  readonly reference: ContentReference;
}

export interface ReplayContext {
  readonly session_id: string;
  readonly started_at: string;
  readonly replay_profile_name: string;
}

export interface ReplayStepResult<TArtifact> {
  readonly stage: ReplayStage;
  readonly reference: ContentReference;
  readonly artifact: TArtifact;
  readonly verification: VerificationResult;
}

export interface ReplayFailure {
  readonly stage: ReplayStage;
  readonly reference: ContentReference;
  readonly reason: string;
  readonly code: string;
  readonly violation_class: string; // e.g. "HashVerificationViolation"
}

export interface ReplayResult {
  readonly context: ReplayContext;
  readonly steps: readonly ReplayStepResult<unknown>[];
  readonly failures: readonly ReplayFailure[];
  readonly completed: boolean;
}
