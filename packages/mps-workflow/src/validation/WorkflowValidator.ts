import { WorkflowDefinitionArtifact } from "../contracts/WorkflowDefinitionArtifact.js";
import { WorkflowExecutionArtifact } from "../artifacts/WorkflowExecutionArtifact.js";

export interface WorkflowValidator {
    validateDefinition(definition: WorkflowDefinitionArtifact): void;
    validateExecution(execution: WorkflowExecutionArtifact): void;
}
