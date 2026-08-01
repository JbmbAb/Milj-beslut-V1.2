import type {
  ArtifactStore,
} from "@miljobeslut/mps-artifact-store";

import type {
  ContentReference,
  VerificationResult,
  ArtifactVerifier,
} from "@miljobeslut/mps-core";

import {
  HashVerificationViolation,
  SignatureVerificationViolation,
  TrustViolation,
} from "@miljobeslut/mps-core";

import type {
  ReplayStage,
  ReplayStepResult,
} from "./ReplayTypes";

export interface ReplayVerifier {
  verify<T>(
    stage: ReplayStage,
    reference: ContentReference
  ): Promise<ReplayStepResult<T>>;
}

export class DefaultReplayVerifier implements ReplayVerifier {

  constructor(
    private readonly store: ArtifactStore,
    private readonly artifactVerifier: ArtifactVerifier
  ) {}

  async verify<T>(
    stage: ReplayStage,
    reference: ContentReference
  ): Promise<ReplayStepResult<T>> {

    const artifact = await this.store.get<T>(reference);

    const verification: VerificationResult =
      await this.artifactVerifier.verify(artifact);

    if (!verification.integrity) {
      throw new HashVerificationViolation(
        "REPLAY_HASH_INTEGRITY_FAILED",
        "Replay detected hash/integrity failure",
        reference
      );
    }

    if (!verification.signature_valid) {
      throw new SignatureVerificationViolation(
        "REPLAY_SIGNATURE_INVALID",
        "Replay detected invalid signature",
        reference
      );
    }

    if (!verification.trusted) {
      throw new TrustViolation(
        "REPLAY_TRUST_ANCHOR_FAILED",
        "Replay detected untrusted artifact",
        reference
      );
    }

    return {
      stage,
      reference,
      artifact,
      verification,
    };
  }
}
