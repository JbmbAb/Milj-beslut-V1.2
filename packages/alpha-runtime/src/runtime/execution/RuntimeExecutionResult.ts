import { HashDescriptor } from "../../types/HashDescriptor";
import { RegistryReference } from "../../types";

export interface RuntimeStepResult {
  step_id: string;
  capability_ref: RegistryReference;
  success: boolean;
  produced_outputs: RegistryReference[];
}

export interface RuntimeExecutionResult {
  readonly execution_identity_hash: HashDescriptor;
  readonly execution_plan_hash: HashDescriptor;
  readonly dependency_resolution: {
    readonly graph_hash: HashDescriptor;
  };
  readonly deterministic_seed: string;
  readonly completed_steps: readonly string[];
  readonly output_references: readonly RegistryReference[];
  readonly completed_at_iso: string;
  
  // Backward compatibility with older tests/schedulers
  outputs: RegistryReference[];
  step_results: RuntimeStepResult[];
}

