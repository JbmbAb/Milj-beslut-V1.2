import { CapabilityDefinition } from "../contracts/CapabilityDefinition.js";
import { CapabilityExecutionArtifact } from "../artifacts/CapabilityExecutionArtifact.js";

export interface CapabilityValidator {
    validateDefinition(definition: CapabilityDefinition): void;
    validateExecution(execution: CapabilityExecutionArtifact): void;
}
