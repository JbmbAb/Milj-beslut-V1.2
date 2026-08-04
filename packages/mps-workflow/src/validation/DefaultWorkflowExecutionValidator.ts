import { WorkflowExecutionArtifact } from "../artifacts/WorkflowExecutionArtifact.js";

export class DefaultWorkflowExecutionValidator {
  validate(execution: WorkflowExecutionArtifact): void {
    if (execution.artifact_type === "GOVERNANCE_APPROVAL_ARTIFACT" as any) {
      throw new Error("WORKFLOW_GOVERNANCE_BOUNDARY_VIOLATION");
    }
  }
}
