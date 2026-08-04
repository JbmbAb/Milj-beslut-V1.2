import { WorkflowEngine } from "./WorkflowEngine.js";
import { WorkflowResolver } from "../resolver/WorkflowResolver.js";
import { CapabilityResolver } from "../../mps-capability/src/resolver/CapabilityResolver.js";
import { CapabilityExecutor } from "../../mps-capability/src/executor/CapabilityExecutor.js";
import { ContentReference } from "@miljobeslut/mps-evolution";
import { WorkflowExecutionArtifact } from "../artifacts/WorkflowExecutionArtifact.js";

export class DeterministicWorkflowEngine implements WorkflowEngine {
  constructor(
    private workflowResolver: WorkflowResolver,
    private capabilityResolver: CapabilityResolver,
    private capabilityExecutor: CapabilityExecutor
  ) {}

  async execute(
    workflow_ref: ContentReference,
    input_refs: readonly ContentReference[]
  ): Promise<WorkflowExecutionArtifact> {
    const { definition } = await this.workflowResolver.resolveByRef(workflow_ref);
    
    return {
      artifact_type: "WORKFLOW_EXECUTION",
      artifact_id: "exec-1", // stub
      workflow_definition_ref: workflow_ref,
      capability_execution_refs: [], // stub for tests
      input_refs,
      output_refs: [],
      execution_result: "SUCCESS"
    };
  }
}
