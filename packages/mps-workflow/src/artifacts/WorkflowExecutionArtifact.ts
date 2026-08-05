import { CanonicalArtifact, ContentReference } from "@miljobeslut/mps-evolution";

export type WorkflowExecutionResult =
  | "SUCCESS"
  | "FAILED_VALIDATION"
  | "FAILED_EXECUTION";

export interface ContentHashFrozen {
  readonly algorithm: "sha256";
  readonly value: string;
}

export interface WorkflowExecutionArtifact extends CanonicalArtifact {
  readonly artifact_type: "WORKFLOW_EXECUTION";

  readonly workflow_definition_ref: ContentReference;

  /** @deprecated use execution_refs — kept for Package24 compatibility */
  readonly capability_execution_refs: readonly ContentReference[];

  /** Frozen: ordered capability execution refs for replay. */
  readonly execution_refs: readonly ContentReference[];

  /** Frozen: explicit step order. */
  readonly execution_order: readonly string[];

  readonly workflow_hash: ContentHashFrozen;
  readonly workflow_definition_hash: ContentHashFrozen;

  readonly input_refs: readonly ContentReference[];
  readonly output_refs: readonly ContentReference[];

  readonly execution_result: WorkflowExecutionResult;

  readonly failure_reason_ref?: ContentReference;
}
