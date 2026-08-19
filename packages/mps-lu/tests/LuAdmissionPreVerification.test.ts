import { describe, it, expect } from "vitest";
import {
  LocalPemSigningKeyProvider,
  LocalPemVerificationKeyProvider,
  createArtifactAttestation,
  type ArtifactAttestation,
} from "@miljobeslut/mimers-brunn-core";
import { preVerifyExecutionIdentityForAdmission } from "../src/execution/LuAdmissionPreVerification.js";
import {
  buildExecutionIdentityAttestationPredicate,
  LU_EXECUTION_IDENTITY_ATTESTATION_PREDICATE_TYPE,
} from "../src/execution/ExecutionIdentityAttestation.js";
import { sha256ContentHash } from "../../mps-runtime/src/kernel/ExecutionKernel.js";
import { RuntimeAdmissionKernel, AdmissionError } from "../../mps-runtime/src/kernel/RuntimeAdmissionKernel.js";
import { RuleRegistrySnapshot } from "../../mps-compliance/src/conformance/RuleRegistrySnapshot.js";
import { CAP_26_I1 } from "../../mps-compliance/src/validators/CAP_26_I1.js";
import type { ExecutionIdentityArtifact } from "../../mps-runtime/src/execution/ExecutionIdentityArtifact.js";
import type { ArtifactContract } from "../../mps-compliance/src/artifacts/ArtifactContract.js";
import type { ExecutionManifestArtifact } from "../../mps-runtime/src/execution/ExecutionManifestArtifact.js";
import type { FrozenCoreVerificationContext } from "../../mps-compliance/src/conformance/FrozenCoreVerificationContext.js";

/**
 * PROD-LU-ADMISSION-02C — proves the pre-verification adapter, not just the standalone
 * verifier (02A already proved that). Reuses 02A's four trust cases through the actual adapter,
 * then proves end-to-end that a denied identity never reaches RuntimeAdmissionKernel.admit().
 */

const { provider: authoritySigner, publicKey } = LocalPemSigningKeyProvider.generate(
  "ed25519:lu-execution-authority-test",
);
const authorityVerifier = new LocalPemVerificationKeyProvider(authoritySigner.keyId, publicKey);
const { provider: impostorSigner } = LocalPemSigningKeyProvider.generate("ed25519:impostor");

const actorRef = { artifact_id: "lu.site_assessment.actor", artifact_type: "execution_identity" as const };
const capabilityRef = { artifact_id: "cap-lu-site-assessment", artifact_type: "CAPABILITY_DEFINITION" as const };
const capabilityArtifact: ArtifactContract = {
  artifact_id: capabilityRef.artifact_id,
  artifact_type: capabilityRef.artifact_type,
  content_hash: { algorithm: "sha256", value: "h-cap" },
  references: [],
};

function buildIdentity(): ExecutionIdentityArtifact {
  return {
    artifact_id: "lu-identity-site-1",
    artifact_type: "execution_identity",
    content_hash: sha256ContentHash({
      principal_id: actorRef.artifact_id,
      site_id: "site-1",
      capability_id: capabilityRef.artifact_id,
      release_snapshot_id: "release-1",
      deterministic_seed: "seed:site-1",
    }),
    references: [],
    actor_ref: actorRef,
    capability_ref: capabilityRef,
    signature_envelope_ref: { artifact_id: "attestation-lu-identity-site-1", artifact_type: "outcome_attestation" },
  };
}

function expectedPredicateFor(identity: ExecutionIdentityArtifact) {
  return buildExecutionIdentityAttestationPredicate({
    execution_identity_id: identity.artifact_id,
    actor_ref: identity.actor_ref,
    capability_ref: identity.capability_ref,
    release_snapshot_id: "release-1",
    site_id: "site-1",
    deterministic_seed: "seed:site-1",
  });
}

async function attestFor(
  identity: ExecutionIdentityArtifact,
  signer: LocalPemSigningKeyProvider,
): Promise<ArtifactAttestation> {
  return createArtifactAttestation({
    subjectDigest: identity.content_hash.value,
    predicateType: LU_EXECUTION_IDENTITY_ATTESTATION_PREDICATE_TYPE,
    predicate: expectedPredicateFor(identity),
    signing: signer,
  });
}

function manifestFor(identity: ExecutionIdentityArtifact): ExecutionManifestArtifact {
  return {
    artifact_id: "manifest-1",
    artifact_type: "execution_manifest",
    content_hash: { algorithm: "sha256", value: "h-manifest" },
    references: [],
    execution_identity_ref: { artifact_id: identity.artifact_id, artifact_type: identity.artifact_type },
    capability_resolution_ref: capabilityRef,
    parameters: { deterministic_seed: "seed:site-1" },
  };
}

function contextFor(artifactResolver: FrozenCoreVerificationContext["artifactResolver"]): FrozenCoreVerificationContext {
  return {
    artifactResolver,
    matrixResolver: { resolve: () => undefined },
    ruleRegistry: new RuleRegistrySnapshot([CAP_26_I1]),
    canonicalSerializer: {
      serialize: () => ({ bytes: new Uint8Array(), encoding: "identity" }),
    } as FrozenCoreVerificationContext["canonicalSerializer"],
  };
}

describe("preVerifyExecutionIdentityForAdmission — PROD-LU-ADMISSION-02C", () => {
  it("1. missing attestation -> denied, identity absent from the sync resolver", async () => {
    const identity = buildIdentity();
    const { result, artifactResolver } = await preVerifyExecutionIdentityForAdmission({
      identity,
      capabilityArtifact,
      resolveAttestation: async () => null,
      expectedPredicate: expectedPredicateFor(identity),
      authorityVerifier,
    });
    expect(result).toEqual({ verified: false, reason: "MISSING_ATTESTATION" });
    expect(artifactResolver.resolve({ artifact_id: identity.artifact_id, artifact_type: identity.artifact_type })).toBeUndefined();
  });

  it("2. unknown signer -> denied, identity absent from the sync resolver", async () => {
    const identity = buildIdentity();
    const attestation = await attestFor(identity, impostorSigner);
    const { result, artifactResolver } = await preVerifyExecutionIdentityForAdmission({
      identity,
      capabilityArtifact,
      resolveAttestation: async () => attestation,
      expectedPredicate: expectedPredicateFor(identity),
      authorityVerifier,
    });
    expect(result).toEqual({ verified: false, reason: "UNKNOWN_SIGNING_KEY" });
    expect(artifactResolver.resolve({ artifact_id: identity.artifact_id, artifact_type: identity.artifact_type })).toBeUndefined();
  });

  it("3. tampered content binding -> denied, identity absent from the sync resolver", async () => {
    const identity = buildIdentity();
    const attestation = await attestFor(identity, authoritySigner);
    const tampered: ExecutionIdentityArtifact = { ...identity, content_hash: sha256ContentHash({ tampered: true }) };
    const { result, artifactResolver } = await preVerifyExecutionIdentityForAdmission({
      identity: tampered,
      capabilityArtifact,
      resolveAttestation: async () => attestation,
      expectedPredicate: expectedPredicateFor(tampered),
      authorityVerifier,
    });
    expect(result).toEqual({ verified: false, reason: "CONTENT_HASH_MISMATCH" });
    expect(artifactResolver.resolve({ artifact_id: tampered.artifact_id, artifact_type: tampered.artifact_type })).toBeUndefined();
  });

  it("4. valid authority-issued identity -> verified, exposed to the sync resolver", async () => {
    const identity = buildIdentity();
    const attestation = await attestFor(identity, authoritySigner);
    const { result, artifactResolver } = await preVerifyExecutionIdentityForAdmission({
      identity,
      capabilityArtifact,
      resolveAttestation: async () => attestation,
      expectedPredicate: expectedPredicateFor(identity),
      authorityVerifier,
    });
    expect(result).toEqual({ verified: true, identity });
    expect(
      artifactResolver.resolve({ artifact_id: identity.artifact_id, artifact_type: identity.artifact_type }),
    ).toEqual(identity);
  });

  it("a structurally correct self-issued identity never reaches RuntimeAdmissionKernel.admit()", async () => {
    const identity = buildIdentity();
    // No attestation at all -- exactly what a caller fabricating its own identity would produce
    // (identical to what LuExecutionKernelClient's un-committed 01C code constructs today).
    const { result, artifactResolver } = await preVerifyExecutionIdentityForAdmission({
      identity,
      capabilityArtifact,
      resolveAttestation: async () => null,
      expectedPredicate: expectedPredicateFor(identity),
      authorityVerifier,
    });
    expect(result.verified).toBe(false);

    const kernel = new RuntimeAdmissionKernel(contextFor(artifactResolver));
    expect(() => kernel.admit(manifestFor(identity))).toThrow(AdmissionError);
    expect(() => kernel.admit(manifestFor(identity))).toThrow(/Invalid or missing Execution Identity/);
  });

  it("counter-proof: an authority-issued identity DOES reach and pass RuntimeAdmissionKernel.admit()", async () => {
    const identity = buildIdentity();
    const attestation = await attestFor(identity, authoritySigner);
    const { result, artifactResolver } = await preVerifyExecutionIdentityForAdmission({
      identity,
      capabilityArtifact,
      resolveAttestation: async () => attestation,
      expectedPredicate: expectedPredicateFor(identity),
      authorityVerifier,
    });
    expect(result.verified).toBe(true);

    const kernel = new RuntimeAdmissionKernel(contextFor(artifactResolver));
    expect(() => kernel.admit(manifestFor(identity))).not.toThrow();
  });
});
