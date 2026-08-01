import { describe, it, expect } from "vitest";
import { DefaultReplayVerifier } from "../ReplayVerifier";
import {
  HashVerificationViolation,
  SignatureVerificationViolation,
  TrustViolation,
  SchemaValidationViolation,
} from "@miljobeslut/mps-core";
import type { ArtifactVerifier, VerificationResult, ContentReference } from "@miljobeslut/mps-core";
import type { ArtifactStore } from "@miljobeslut/mps-artifact-store";

function fakeRef(id: string): ContentReference {
  return { id, content_hash: { algorithm: "sha256", digest: `digest:${id}` } };
}

function makeStore(artifact: unknown): ArtifactStore {
  return {
    get: async () => artifact,
    put: async () => { throw new Error("not used in this test"); },
    has: async () => true,
  } as unknown as ArtifactStore;
}

function makeVerifier(result: VerificationResult): ArtifactVerifier {
  return {
    verify: async () => result,
  };
}

describe("DefaultReplayVerifier: error classification", () => {
  const reference = fakeRef("artifact-1");
  const artifact = { some: "payload" };

  it("throws HashVerificationViolation when integrity fails", async () => {
    const store = makeStore(artifact);
    const artifactVerifier = makeVerifier({
      integrity: false,
      signature_valid: true,
      trusted: true,
    });
    const replayVerifier = new DefaultReplayVerifier(store, artifactVerifier);

    await expect(replayVerifier.verify("GOVERNANCE", reference)).rejects.toBeInstanceOf(
      HashVerificationViolation,
    );
  });

  it("throws SignatureVerificationViolation when signature is invalid", async () => {
    const store = makeStore(artifact);
    const artifactVerifier = makeVerifier({
      integrity: true,
      signature_valid: false,
      trusted: true,
    });
    const replayVerifier = new DefaultReplayVerifier(store, artifactVerifier);

    await expect(replayVerifier.verify("GOVERNANCE", reference)).rejects.toBeInstanceOf(
      SignatureVerificationViolation,
    );
  });

  it("REGRESSION: throws TrustViolation (not SchemaValidationViolation) when trust fails", async () => {
    const store = makeStore(artifact);
    const artifactVerifier = makeVerifier({
      integrity: true,
      signature_valid: true,
      trusted: false,
    });
    const replayVerifier = new DefaultReplayVerifier(store, artifactVerifier);

    const promise = replayVerifier.verify("GOVERNANCE", reference);

    // The specific regression this guards against: a trust-anchor failure
    // must never be reported as a schema problem. Someone debugging via
    // `instanceof SchemaValidationViolation` must not misclassify this.
    await expect(promise).rejects.toBeInstanceOf(TrustViolation);
    await expect(promise).rejects.not.toBeInstanceOf(SchemaValidationViolation);
  });

  it("returns a successful ReplayStepResult when all checks pass", async () => {
    const store = makeStore(artifact);
    const verification: VerificationResult = {
      integrity: true,
      signature_valid: true,
      trusted: true,
    };
    const artifactVerifier = makeVerifier(verification);
    const replayVerifier = new DefaultReplayVerifier(store, artifactVerifier);

    const step = await replayVerifier.verify("ARCHIVE", reference);

    expect(step.stage).toBe("ARCHIVE");
    expect(step.reference).toEqual(reference);
    expect(step.artifact).toEqual(artifact);
    expect(step.verification).toEqual(verification);
  });
});
