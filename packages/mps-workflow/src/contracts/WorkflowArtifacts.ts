import { CanonicalArtifact, ContentReference } from "@miljobeslut/mps-evolution";

export interface WorkflowDefinitionArtifact extends CanonicalArtifact {
  readonly artifact_type: "WORKFLOW_DEFINITION_ARTIFACT";
  readonly definition_key: string;
  readonly steps: readonly unknown[];
}

// FLOW-24-19: Execution Manifest
export interface WorkflowExecutionArtifact extends CanonicalArtifact {
  readonly artifact_type: "WORKFLOW_EXECUTION_ARTIFACT";
  readonly workflow_ref: ContentReference;
  readonly execution_key: string;
  
  // FLOW-24-19-I5: Replayable Execution
  readonly input_refs: readonly ContentReference[];
  readonly output_refs: readonly ContentReference[];
  readonly event_sequence_refs: readonly ContentReference[];
  
  readonly execution_status: "COMPLETED" | "FAILED";
  readonly executor_version: string;
}
