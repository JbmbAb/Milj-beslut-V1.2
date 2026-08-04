import { ContentReference } from "@miljobeslut/mps-evolution/src/core/types.js";
import { CapabilityRegistryArtifact } from "../artifacts/CapabilityRegistryArtifact.js";

export interface RegistryEngine {
    registerCapability(
        capability_ref: ContentReference,
        implementation_ref: ContentReference,
        compatibility: string[],
        policy_ref?: ContentReference
    ): Promise<CapabilityRegistryArtifact>;

    deprecateCapability(
        capability_ref: ContentReference,
        implementation_ref: ContentReference,
        policy_ref?: ContentReference
    ): Promise<CapabilityRegistryArtifact>;
}
