import { ArtifactRepository } from "@miljobeslut/mps-artifact-store";
import { ContentReference } from "@miljobeslut/mps-evolution";
import { CapabilityDefinition } from "../contracts/CapabilityDefinition.js";
import { CapabilityExecutionArtifact } from "../artifacts/CapabilityExecutionArtifact.js";

export class DeterministicCapabilityExecutor {
  constructor(private readonly repository: ArtifactRepository) {}

  async execute(capability: CapabilityDefinition, inputs: ContentReference[]): Promise<CapabilityExecutionArtifact> {
    const impl = await this.repository.resolver.resolve(capability.implementation_ref as any);
    
    // Simulate deterministic execution producing an artifact
    return {
      artifact_type: "CAPABILITY_EXECUTION",
      artifact_id: `exec-${capability.artifact_id}`,
      capability_ref: { artifact_id: capability.artifact_id },
      input_refs: inputs,
      output_refs: [{ artifact_id: `output-${(impl as any).artifact_id}` }]
    } as any;
  }
}
