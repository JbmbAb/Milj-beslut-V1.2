import { ContentReference } from "@miljobeslut/mps-evolution/src/core/types.js";
import { WorkflowStep } from "../contracts/WorkflowStep.js";

export interface WorkflowStepResolver {
    resolve(step_ref: ContentReference): Promise<WorkflowStep>;
}
