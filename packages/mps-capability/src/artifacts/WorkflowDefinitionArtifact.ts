import { CanonicalArtifact, ContentReference } from "@miljobeslut/mps-evolution/src/core/types.js";
import { Permission, WorkflowInputMapping, WorkflowOutputMapping } from "../types.js";

export interface WorkflowStep {
    step_key: string;                  // semantic only
    capability_ref: ContentReference;
    input_mapping: WorkflowInputMapping[];
    output_mapping: WorkflowOutputMapping[];
}

export interface WorkflowDefinitionArtifact extends CanonicalArtifact {
    artifact_type: "WORKFLOW_DEFINITION";
    workflow_key: string;
    workflow_version: string;
    steps: WorkflowStep[];
    required_capabilities: ContentReference[];
    required_permissions: Permission[];
}
