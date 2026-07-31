import { HashDescriptor, RegistryReference } from "../types";

export interface CapabilityExecutionContext {
  readonly execution_id: string;
  readonly step_id: string;
  readonly execution_seed?: string;
  readonly world_state_root: HashDescriptor;
  readonly input_refs: RegistryReference[];
  readonly policy_ref: RegistryReference;
  readonly metadata?: Record<string, unknown>;
}
