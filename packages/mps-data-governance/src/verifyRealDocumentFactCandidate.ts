import { canonicalizeStrict } from "@miljobeslut/mimers-brunn-core";
import { createHash } from "node:crypto";
import type { ActorReference, ContentReference, HashDescriptor, SignatureDescriptor } from "../../mps-core/src/types";
import {
  verifyDocumentFactCandidate,
  type DocumentFactCandidateArtifact,
  type DocumentFactVerification,
  type DocumentFactVerificationMethod,
  type DocumentFactVerificationPolicy,
  type VerifiedDocumentFactArtifact,
} from "./DocumentFactArtifact";
import { isDocumentFactCandidateContentHashValid } from "./createDocumentFactCandidate";

/**
 * DOCUMENT-FACT-HUMAN-VERIFICATION-V1.
 *
 * The frozen `verifyDocumentFactCandidate` (DocumentFactArtifact.ts, OWNER FREEZE 2026-08-12)
 * enforces the real governance gate -- policy-admitted method, governance/human verifier role,
 * asserter != verifier, valid span -- but it does not compute the VERIFIED artifact's identity
 * (it takes `artifact_id`/`content_hash`/`signature` as caller-supplied arguments) and it does
 * not check that a caller-supplied `candidate_ref` actually matches the candidate being verified.
 * This wrapper closes both gaps at the call site rather than touching the frozen file:
 *   - `candidate_ref` is always derived from the real candidate's own artifact_id/content_hash,
 *     never accepted as a separate caller-supplied value that could point elsewhere.
 *   - identity/content_hash are computed deterministically here, the same pattern as
 *     `createDocumentFactCandidate`, with `verified_at` excluded (IMPORT-TIME-001/SV-I06).
 * It additionally refuses to verify a candidate whose own content_hash no longer matches its
 * carried fields -- tamper detection the frozen gate does not perform.
 */
export const VERIFIED_DOCUMENT_FACT_CONTRACT_VERSION = "verified-document-fact-v1" as const;

export interface DocumentFactReviewInput {
  readonly candidate: DocumentFactCandidateArtifact;
  readonly verified_by: ActorReference;
  readonly verification_method: DocumentFactVerificationMethod;
  readonly policy: DocumentFactVerificationPolicy;
  /** Provenance only -- excluded from identity/content hashing, per IMPORT-TIME-001. */
  readonly verified_at: string;
}

export interface DocumentFactReviewSigner {
  readonly keyId: string;
  sign(bytes: Uint8Array): Promise<{ readonly signatureBase64: string }>;
}

function sha256Hex(payload: unknown): string {
  return createHash("sha256").update(Buffer.from(canonicalizeStrict(payload), "utf8")).digest("hex");
}

function candidateRefOf(candidate: DocumentFactCandidateArtifact): ContentReference {
  return { id: candidate.artifact_id, content_hash: candidate.content_hash };
}

/** The exact fields that determine the VERIFIED artifact's identity. `verified_at` is deliberately absent. */
function verifiedIdentityCore(input: DocumentFactReviewInput, candidateRef: ContentReference): Record<string, unknown> {
  const { candidate } = input;
  return {
    artifact_type: "VERIFIED_DOCUMENT_FACT",
    contract_version: VERIFIED_DOCUMENT_FACT_CONTRACT_VERSION,
    verification_status: "VERIFIED",
    candidate_ref: candidateRef,
    fact_type: candidate.fact_type,
    fact_version: candidate.fact_version,
    source_document_ref: candidate.source_document_ref,
    inventory_ref: candidate.inventory_ref,
    source_span: candidate.source_span,
    ...(candidate.subject_ref !== undefined ? { subject_ref: candidate.subject_ref } : {}),
    assertion: {
      asserted_by: candidate.assertion.asserted_by,
      assertion_method: candidate.assertion.assertion_method,
      asserter_version: candidate.assertion.asserter_version,
    },
    verification: {
      verified_by: input.verified_by,
      verification_method: input.verification_method,
      verification_policy_version: input.policy.policy_version,
    },
  };
}

/**
 * Deterministic identity the VERIFIED artifact WOULD get -- lets a caller (or the RED proof)
 * assert "same candidate + same review semantics -> same identity" without needing a signer.
 */
export function computeVerifiedDocumentFactIdentity(input: DocumentFactReviewInput): string {
  return `fact-verified-${sha256Hex(verifiedIdentityCore(input, candidateRefOf(input.candidate))).slice(0, 24)}`;
}

/**
 * Promotes a real `DocumentFactCandidateArtifact` to a real `VerifiedDocumentFactArtifact`
 * through the frozen governance gate, given an ALREADY-MADE human review decision (`verified_by`
 * must resolve to a real governance/human identity; this function performs no review of its own
 * -- it records one that already happened and refuses to construct anything if the frozen gate
 * rejects it for any reason, including asserter/verifier identity collision).
 */
export async function verifyRealDocumentFactCandidate(
  input: DocumentFactReviewInput,
  signer: DocumentFactReviewSigner,
): Promise<VerifiedDocumentFactArtifact> {
  if (!isDocumentFactCandidateContentHashValid(input.candidate)) {
    throw new Error(
      "REJECT_DOCUMENT_FACT_VERIFICATION: candidate content_hash does not match its own carried " +
        "fields -- tampered or malformed candidate, refusing to bind a review to it.",
    );
  }

  const candidateRef = candidateRefOf(input.candidate);
  const artifactId = computeVerifiedDocumentFactIdentity(input);
  const bare = { artifact_id: artifactId, ...verifiedIdentityCore(input, candidateRef) };
  const contentHash: HashDescriptor = { algorithm: "sha256", digest: sha256Hex(bare) };

  const signed = await signer.sign(Buffer.from(contentHash.digest, "hex"));
  const signature: SignatureDescriptor = {
    algorithm: "Ed25519",
    signature: `ed25519:${signed.signatureBase64}`,
    key_id: signer.keyId,
  };

  const verification: DocumentFactVerification = {
    verified_by: input.verified_by,
    verification_method: input.verification_method,
    verification_policy_version: input.policy.policy_version,
    verified_at: input.verified_at,
  };

  return verifyDocumentFactCandidate({
    candidate: input.candidate,
    candidate_ref: candidateRef,
    verification,
    policy: input.policy,
    artifact_id: artifactId,
    content_hash: contentHash,
    signature,
  });
}
