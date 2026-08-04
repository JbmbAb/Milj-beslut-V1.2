import { CanonicalArtifact, ContentReference } from "@miljobeslut/mps-evolution";
import { DependencyAnalysisArtifact } from "./DependencyArtifacts.js";

export type ConstraintSeverity =
  | "WARNING"
  | "ERROR"
  | "BLOCKING";

export type ConstraintKind =
  | "LAYER_DIRECTION"
  | "DOMAIN_ISOLATION"
  | "CYCLE_RULE"
  | "MAX_DEPTH"
  | "COMBINATION_RULE"
  | "PROFILE_SPECIFIC"
  | "EXCEPTION_RULE"; // CONSTRAINT-24-09-I8: Exception Semantics

export interface DependencyConstraintArtifact extends CanonicalArtifact {
  readonly artifact_type: "DEPENDENCY_CONSTRAINT_ARTIFACT";

  readonly constraint_key: string;
  readonly constraint_kind: ConstraintKind;
  readonly severity: ConstraintSeverity;

  readonly rule_payload: unknown;
}

export interface DependencyConstraintProfileArtifact extends CanonicalArtifact {
  readonly artifact_type: "DEPENDENCY_CONSTRAINT_PROFILE_ARTIFACT";

  readonly profile_key: string;
  readonly constraint_refs: readonly ContentReference[];
}

export type ConstraintEvaluationStatus =
  | "PASSED"
  | "WARNING"
  | "FAILED"
  | "NOT_APPLICABLE"; // CONSTRAINT-24-09-I4: Explicit Outcome

export interface DependencyViolationArtifact extends CanonicalArtifact {
  readonly artifact_type: "DEPENDENCY_VIOLATION_ARTIFACT";

  readonly dependency_ref: ContentReference;
  readonly constraint_ref: ContentReference;
  readonly evaluation_ref: ContentReference;

  readonly violation_code: string;
  readonly reason?: string;
}

export interface DependencyConstraintEvaluationArtifact extends CanonicalArtifact {
  readonly artifact_type: "DEPENDENCY_CONSTRAINT_EVALUATION_ARTIFACT";

  readonly analysis_ref: ContentReference;
  readonly profile_ref: ContentReference;
  readonly evaluator_version: string;
  readonly status: ConstraintEvaluationStatus;

  readonly violation_refs: readonly ContentReference[];
}
