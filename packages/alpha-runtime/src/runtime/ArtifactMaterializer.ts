import { CapabilityOutput } from "../capability/CapabilityOutput";
import { RegistryReference } from "../types";

export class ArtifactMaterializer {
  constructor(private artifactFactory: any) {}

  async materialize(output: CapabilityOutput): Promise<RegistryReference[]> {
    const refs: RegistryReference[] = [];
    for (const art of output.artifacts) {
      const created = await this.artifactFactory.createArtifact(art.payload);
      // Mock materialization process mapping simple interface
      refs.push({
        id: created.id,
        version: created.version,
        content_hash: created.content_hash,
        schema_ref: art.schema_ref
      });
    }
    return refs;
  }
}
