import { createHash } from "node:crypto";
import type { ContentReference } from "@miljobeslut/mps-evolution";
import type { WorkflowEngine } from "./WorkflowEngine.js";
import type { WorkflowResolver } from "../resolver/WorkflowResolver.js";
import type { CapabilityResolver } from "../../../mps-capability/src/resolver/CapabilityResolver.js";
import type { CapabilityExecutor } from "../../../mps-capability/src/executor/CapabilityExecutor.js";
import type { WorkflowExecutionArtifact } from "../artifacts/WorkflowExecutionArtifact.js";

/**
 * WorkflowExecutor with real step loop emitting frozen WorkflowExecutionArtifact fields.
 */
export class DeterministicWorkflowEngine implements WorkflowEngine {
  constructor(
    private workflowResolver: WorkflowResolver,
    private capabilityResolver: CapabilityResolver,
    private capabilityExecutor: CapabilityExecutor,
  ) {}

  async execute(
    workflow_ref: ContentReference,
    input_refs: readonly ContentReference[],
  ): Promise<WorkflowExecutionArtifact> {
    const { definition } = await this.workflowResolver.resolveByRef(workflow_ref);
    const steps = (definition as { steps?: readonly { step_id: string; capability_ref: ContentReference }[] })
      .steps ?? [];

    const execution_refs: ContentReference[] = [];
    const execution_order: string[] = [];
    let outputs: ContentReference[] = [...input_refs];

    for (const step of steps) {
      const { definition: capability } = await this.capabilityResolver.resolveByRef(
        step.capability_ref,
      );
      const capExec = await this.capabilityExecutor.execute(capability, outputs);
      execution_refs.push({ artifact_id: capExec.artifact_id });
      execution_order.push(step.step_id);
      outputs = capExec.output_refs;
    }

    const workflow_definition_hash = {
      algorithm: "sha256" as const,
      value: createHash("sha256")
        .update(JSON.stringify({ workflow_id: (definition as { artifact_id?: string }).artifact_id, steps: execution_order }))
        .digest("hex"),
    };

    const workflow_hash = {
      algorithm: "sha256" as const,
      value: createHash("sha256")
        .update(
          JSON.stringify({
            execution_refs: execution_refs.map((r) => r.artifact_id),
            execution_order,
          }),
        )
        .digest("hex"),
    };

    const content_hash = createHash("sha256")
      .update(
        JSON.stringify({
          workflow_hash: workflow_hash.value,
          workflow_definition_hash: workflow_definition_hash.value,
          execution_refs: execution_refs.map((r) => r.artifact_id),
          execution_order,
        }),
      )
      .digest("hex");

    return {
      artifact_type: "WORKFLOW_EXECUTION",
      artifact_id: `wf-exec-${workflow_ref.artifact_id}-${content_hash.slice(0, 12)}`,
      content_hash,
      schema_version: "1.0",
      signature: { algorithm: "SHA256", value: content_hash },
      workflow_definition_ref: workflow_ref,
      capability_execution_refs: execution_refs,
      execution_refs,
      execution_order,
      workflow_hash,
      workflow_definition_hash,
      input_refs,
      output_refs: outputs,
      execution_result: "SUCCESS",
    };
  }
}
