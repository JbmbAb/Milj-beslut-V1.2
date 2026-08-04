import { ContentReference } from "@miljobeslut/mps-evolution/src/core/types.js";
import { CapabilityRegistryArtifact } from "../artifacts/CapabilityRegistryArtifact.js";

export interface RegistryResolver {
    resolve(capability_ref: ContentReference): Promise<CapabilityRegistryArtifact[]>;
}
