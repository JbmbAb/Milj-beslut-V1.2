import { CapabilityRegistryArtifact } from "../artifacts/CapabilityRegistryArtifact.js";

export interface RegistryValidator {
    validate(entry: CapabilityRegistryArtifact): void;
}
