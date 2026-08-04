import { CapabilityDefinition } from "../contracts/CapabilityDefinition.js";
import { CanonicalImplementationArtifact } from "../contracts/CanonicalImplementationArtifact.js";

export class DefaultImplementationReferenceValidator {
  validate(capability: CapabilityDefinition, implementation: CanonicalImplementationArtifact): void {
    if (capability.implementation_ref.artifact_id !== implementation.artifact_id) {
      throw new Error("IMPLEMENTATION_REFERENCE_VIOLATION");
    }
  }
}
