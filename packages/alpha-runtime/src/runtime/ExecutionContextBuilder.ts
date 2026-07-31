import { CapabilityExecutionContext } from "../capability/CapabilityExecutionContext";
import { ExecutionManifest } from "../execution/ExecutionManifest";
import { ExecutionPlanArtifact, ExecutionStep } from "../execution/ExecutionPlanArtifact";

export class ExecutionContextBuilder {
  build(
    manifest: ExecutionManifest,
    plan: ExecutionPlanArtifact,
    step: ExecutionStep
  ): CapabilityExecutionContext {
    return {
      execution_id: manifest.identity.execution_id,
      step_id: step.step_id,
      execution_seed: manifest.identity.deterministic_seed,
      world_state_root: manifest.world_state.state_root,
      input_refs: step.inputs,
      policy_ref: manifest.policy_ref,
      metadata: {
        planner_version: plan.planner_version
      }
    };
  }
}
