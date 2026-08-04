import { ContentReference } from "@miljobeslut/mps-evolution/src/core/types.js";

export interface WorkflowViewModel {
    id: string;
    name: string;
    steps: {
        id: string;
        capability_name: string;
        status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";
    }[];
    definition_ref: ContentReference;
}
