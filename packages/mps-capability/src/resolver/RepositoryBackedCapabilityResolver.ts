import { ContentReference, ArtifactRepository } from "@miljobeslut/mps-evolution/src/core/types.js";
import { CapabilityDefinition } from "../contracts/CapabilityDefinition.js";

export class RepositoryBackedCapabilityResolver {
  constructor(private readonly repository: ArtifactRepository) {}

  async resolveByRef(ref: ContentReference): Promise<{ trace: { source: string; artifactRef: ContentReference }; capability: CapabilityDefinition }> {
    const artifact = await this.repository.resolve(ref);
    return {
      trace: {
        source: "ArtifactRepository",
        artifactRef: ref
      },
      capability: artifact as CapabilityDefinition
    };
  }
}
