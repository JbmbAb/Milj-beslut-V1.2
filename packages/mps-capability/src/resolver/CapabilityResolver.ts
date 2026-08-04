import { ContentReference } from "@miljobeslut/mps-evolution";
import { CapabilityDefinition } from "../contracts/CapabilityDefinition.js";

export interface CapabilityResolutionTrace {
  readonly source: "ArtifactRepository";
  readonly artifactRef: ContentReference;
}

export interface CapabilityResolver {
  resolveByRef(
    ref: ContentReference
  ): Promise<{
    definition: CapabilityDefinition;
    trace: CapabilityResolutionTrace;
  }>;
  
  discoverByKey(
    capabilityKey: string
  ): Promise<CapabilityDefinition[]>;
}
