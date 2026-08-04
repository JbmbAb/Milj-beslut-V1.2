import { CanonicalArtifact, ContentReference } from "@miljobeslut/mps-evolution";

export type WorkflowExecutionResult =
  | "SUCCESS"
  | "FAILED_VALIDATION"
  | "FAILED_EXECUTION";

export interface WorkflowExecutionArtifact extends CanonicalArtifact {
  readonly artifact_type: "WORKFLOW_EXECUTION";

  /**
   * Provenance root.
   */
  readonly workflow_definition_ref: ContentReference;

  /**
   * All capability executions performed.
   */
  readonly capability_execution_refs: readonly ContentReference[];

  readonly input_refs: readonly ContentReference[];
  readonly output_refs: readonly ContentReference[];

  readonly execution_result: WorkflowExecutionResult;

  readonly failure_reason_ref?: ContentReference;
}
