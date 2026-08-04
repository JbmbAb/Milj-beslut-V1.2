import { CanonicalArtifact, ContentReference } from "@miljobeslut/mps-evolution/src/core/types.js";

export interface WorkflowExecutionArtifact extends CanonicalArtifact {
    artifact_type: "WORKFLOW_EXECUTION";
    workflow_definition_ref: ContentReference;
    capability_execution_refs: ContentReference[];
    input_refs: ContentReference[];
    output_refs: ContentReference[];
    execution_result: "SUCCESS" | "FAILED_VALIDATION" | "FAILED_EXECUTION";
    failure_reason_ref?: ContentReference;
}
