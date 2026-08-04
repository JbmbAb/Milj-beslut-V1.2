export type Permission = "READ_ARTIFACT" | "EVALUATE_FITNESS" | "EXECUTE_WORKFLOW" | "MANAGE_REGISTRY";

export interface CanonicalMetadata {
    [key: string]: any;
}

export interface WorkflowInputMapping {
    source_step: string;
    source_output: string;
    target_input: string;
}

export interface WorkflowOutputMapping {
    source_step: string;
    source_output: string;
    workflow_output: string;
}
