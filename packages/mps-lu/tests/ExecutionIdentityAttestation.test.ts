import { describe, it, expect } from "vitest";
import {
  LocalPemSigningKeyProvider,
  LocalPemVerificationKeyProvider,
  createArtifactAttestation,
  type ArtifactAttestation,
} from "@miljobeslut/mimers-brunn-core";
import {
  buildExecutionIdentityAttestationPredicate,
  verifyExecutionIdentityAttestation,
  LU_EXECUTION_IDENTITY_ATTESTATION_PREDICATE_TYPE,
} from "../src/execution/ExecutionIdentityAttestation.js";
import { sha256ContentHash } from "../../mps-runtime/src/kernel/ExecutionKernel.js";
import type { ExecutionIdentityArtifact } from "../../mps-runtime/src/execution/ExecutionIdentityArtifact.js";

/**
 * PROD-LU-ADMISSION-02A — proof that verification actually binds the identity used at
 * admission to the attestation, not just that "someone signed some bytes". Uses a locally
 * generated Ed25519 key pair standing in for the LU execution authority; the authority's
 * real env-backed wiring is 02B, out of scope here.
 */

const { provider: authoritySigner, publicKey } = LocalPemSigningKeyProvider.generate(
  "ed25519:lu-execution-authority-test",
);
const authorityVerifier = new LocalPemVerificationKeyProvider(authoritySigner.keyId, publicKey);

const { provider: impostorSigner } = LocalPemSigningKeyProvider.generate("ed25519:impostor");

const actorRef = { artifact_id: "lu.site_assessment.actor", artifact_type: "execution_identity" as const };
const capabilityRef = { artifact_id: "cap-lu-site-assessment", artifact_type: "CAPABILITY_DEFINITION" as const };

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

async function attestFor(
  identity: ExecutionIdentityArtifact,
  signer: LocalPemSigningKeyProvider,
  overrides: Partial<{ site_id: string; capability_ref: typeof capabilityRef }> = {},
): Promise<ArtifactAttestation> {
  const predicate = buildExecutionIdentityAttestationPredicate({
    execution_identity_id: identity.artifact_id,
    actor_ref: identity.actor_ref,
    capability_ref: overrides.capability_ref ?? identity.capability_ref,
    release_snapshot_id: "release-1",
    site_id: overrides.site_id ?? "site-1",
    deterministic_seed: "seed:site-1",
  });
  return createArtifactAttestation({
    subjectDigest: identity.content_hash.value,
    predicateType: LU_EXECUTION_IDENTITY_ATTESTATION_PREDICATE_TYPE,
    predicate,
    signing: signer,
  });
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

describe("verifyExecutionIdentityAttestation — PROD-LU-ADMISSION-02 trust boundary", () => {
  it("1. no attestation -> DENIED / MISSING_ATTESTATION", async () => {
    const identity = buildIdentity();
    const result = await verifyExecutionIdentityAttestation({
      identity,
      attestation: null,
      expectedPredicate: expectedPredicateFor(identity),
      authorityVerifier,
    });
    expect(result).toEqual({ verified: false, reason: "MISSING_ATTESTATION" });
  });

  it("2. self-signed with an unknown key -> DENIED / UNKNOWN_SIGNING_KEY", async () => {
    const identity = buildIdentity();
    const attestation = await attestFor(identity, impostorSigner);
    const result = await verifyExecutionIdentityAttestation({
      identity,
      attestation,
      expectedPredicate: expectedPredicateFor(identity),
      authorityVerifier,
    });
    expect(result).toEqual({ verified: false, reason: "UNKNOWN_SIGNING_KEY" });
  });

  it("3a. authority-signed, then identity content mutated -> DENIED / CONTENT_HASH_MISMATCH", async () => {
    const identity = buildIdentity();
    const attestation = await attestFor(identity, authoritySigner);
    const mutatedIdentity: ExecutionIdentityArtifact = {
      ...identity,
      content_hash: sha256ContentHash({ tampered: true }),
    };
    const result = await verifyExecutionIdentityAttestation({
      identity: mutatedIdentity,
      attestation,
      expectedPredicate: expectedPredicateFor(mutatedIdentity),
      authorityVerifier,
    });
    expect(result).toEqual({ verified: false, reason: "CONTENT_HASH_MISMATCH" });
  });

  it("3b. authority-signed for one capability, reused for another -> DENIED / PREDICATE_MISMATCH", async () => {
    const identity = buildIdentity();
    const otherCapabilityRef = { artifact_id: "cap-different", artifact_type: "CAPABILITY_DEFINITION" as const };
    const attestation = await attestFor(identity, authoritySigner, { capability_ref: otherCapabilityRef });
    const result = await verifyExecutionIdentityAttestation({
      identity,
      attestation,
      expectedPredicate: expectedPredicateFor(identity),
      authorityVerifier,
    });
    expect(result).toEqual({ verified: false, reason: "PREDICATE_MISMATCH" });
  });

  it("3c. authority-signed for one site, replayed for another site -> DENIED / PREDICATE_MISMATCH", async () => {
    const identity = buildIdentity();
    const attestation = await attestFor(identity, authoritySigner, { site_id: "site-2" });
    const result = await verifyExecutionIdentityAttestation({
      identity,
      attestation,
      expectedPredicate: expectedPredicateFor(identity),
      authorityVerifier,
    });
    expect(result).toEqual({ verified: false, reason: "PREDICATE_MISMATCH" });
  });

  it("4. untouched authority-issued identity -> VERIFIED", async () => {
    const identity = buildIdentity();
    const attestation = await attestFor(identity, authoritySigner);
    const result = await verifyExecutionIdentityAttestation({
      identity,
      attestation,
      expectedPredicate: expectedPredicateFor(identity),
      authorityVerifier,
    });
    expect(result).toEqual({ verified: true, identity });
  });
});
