import { RegistryReference } from "../../types";
import { CapabilityAdapter, CapabilityOutput } from "../../capability/CapabilityOutput";
import { CapabilityExecutionContext } from "../../capability/CapabilityExecutionContext";

export function createCapabilityRegistry() {
  return {
    getAdapter: async (capabilityRef: RegistryReference): Promise<CapabilityAdapter> => {
      return {
        capability_id: capabilityRef.id,
        execute: async (context: CapabilityExecutionContext): Promise<CapabilityOutput> => {
          // Fake some processing, incorporating the deterministic seed to make output deterministic
          return {
            artifacts: [
              {
                logical_id: `output-from-${capabilityRef.id}`,
                payload: { processed: true, seed: context.execution_seed, step: context.step_id }
              }
            ],
            execution: {
              execution_id: context.execution_id,
              step_id: context.step_id,
              seed_used: context.execution_seed,
              execution_mode: "deterministic"
            }
          };
        }
      };
    }
  };
}
