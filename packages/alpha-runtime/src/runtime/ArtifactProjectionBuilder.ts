import { CapabilityOutput } from "../capability/CapabilityOutput";
import { RegistryReference } from "../types";
import { CanonicalIdentityProvider } from "../recovery/CanonicalIdentityProvider";
import { CanonicalizerId } from "../recovery/CanonicalizerRegistry";

/**
 * Builds runtime projections of capability outputs: execution output references
 * used for replay and UI representation.
 *
 * MAT-I05: this is not a truth producer. It never creates DecisionImpactArtifact,
 * evidence authority or CAS identity. Decision Truth comes from mps-materialization.
 */
export class ArtifactProjectionBuilder {
  constructor(
    private artifactFactory: any,
    private canonicalizerId: CanonicalizerId = 'runtime-projection-1',
    private materializationVersion: string = 'v1',
    private ruleVersion: string = 'v1'
  ) {}

  async project(output: CapabilityOutput, extractionModel?: string): Promise<RegistryReference[]> {
    const refs: RegistryReference[] = [];
    
    for (const art of output.artifacts) {
      // Create raw representation via factory
      const created = await this.artifactFactory.createArtifact(art.payload);
      
      // MAT-I02: the builder requests identity instead of hashing on its own.
      const content_hash = CanonicalIdentityProvider.generateProjectionIdentity(
        this.canonicalizerId,
        created.evidenceRefs || [],
        created.facts || {},
        this.ruleVersion,
        this.materializationVersion,
        { extraction_model: extractionModel }
      );

      refs.push({
        id: created.id,
        version: created.version,
        content_hash,
        schema_ref: art.schema_ref
      });
    }
    
    return refs;
  }
}
