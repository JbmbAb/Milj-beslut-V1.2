import type {
  ContentReference,
  VerificationResult,
  ArtifactVerifier,
} from "@miljobeslut/mps-core";
import { RegistryVerificationViolation } from "./RegistryErrors";

export class RegistryValidator {
  constructor(private readonly verifier: ArtifactVerifier) {}

  async validate(
    artifact: unknown,
    reference: ContentReference
  ): Promise<VerificationResult> {
    const result = await this.verifier.verify(artifact);

    if (!result.integrity) {
      throw new RegistryVerificationViolation(
        "REGISTRY_INTEGRITY_FAILED",
        "Registry artifact integrity verification failed",
        reference
      );
    }

    if (!result.signature_valid) {
      throw new RegistryVerificationViolation(
        "REGISTRY_SIGNATURE_INVALID",
        "Registry artifact signature verification failed",
        reference
      );
    }

    if (!result.trusted) {
      throw new RegistryVerificationViolation(
        "REGISTRY_TRUST_FAILED",
        "Registry artifact trust verification failed",
        reference
      );
    }

    return result;
  }
}
