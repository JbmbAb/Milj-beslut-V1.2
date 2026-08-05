import { ArtifactRepository } from "@miljobeslut/mps-artifact-store";
import { ContentReference } from "@miljobeslut/mps-evolution";
import { CapabilityDefinition } from "../contracts/CapabilityDefinition.js";

export class RepositoryBackedCapabilityResolver {
  constructor(private readonly repository: ArtifactRepository) {}

  async resolveByRef(ref: ContentReference): Promise<{ trace: { source: string; artifactRef: ContentReference }; capability: CapabilityDefinition }> {
    const artifact = await this.repository.resolver.resolve({ artifactId: ref.hash } as any);
    return {
      trace: {
        source: "ArtifactRepository",
        artifactRef: ref
      },
      capability: artifact as CapabilityDefinition
    };
  }
}
