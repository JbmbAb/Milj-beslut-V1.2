import { ContentReference } from "@miljobeslut/mps-evolution";
import { CapabilityDefinition } from "../contracts/CapabilityDefinition.js";
import { CapabilityExecutionArtifact } from "../contracts/CapabilityExecutionArtifact.js";

export interface CapabilityExecutor {
  execute(
    capability: CapabilityDefinition,
    inputRefs: readonly ContentReference[]
  ): Promise<CapabilityExecutionArtifact>;
}
