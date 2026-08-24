import { canonicalizeStrict } from "@miljobeslut/mimers-brunn-core";
import { createHash } from "node:crypto";
import type { ActorReference, ContentReference, HashDescriptor, SignatureDescriptor } from "../../mps-core/src/types";
import {
  isValidSpan,
  type DocumentFactAssertionMethod,
  type DocumentFactCandidateArtifact,
  type DocumentFactSourceSpan,
  type DocumentFactType,
} from "./DocumentFactArtifact";

/**
 * DOCUMENT-FACT-CANDIDATE-V1.
 *
 * The frozen `DocumentFactCandidateArtifact` type (DocumentFactArtifact.ts, OWNER FREEZE
 * 2026-08-12) had no constructor anywhere in production code -- every existing occurrence
 * (DocumentFactModel.test.ts, mps-lu/tests/fixtures/verifiedDocumentFact.ts) hand-builds the
 * object with fabricated hashes like `hash-cand-1`. This is the first real, deterministic
 * factory: identical inputs always produce the identical `artifact_id`, and the object is
 * cryptographically signed by the asserting process's own key -- not by governance, and not
 * self-verified (verification_status stays "CANDIDATE"; only `verifyDocumentFactCandidate`
 * under a frozen policy, driven by a separate governance identity, may promote it).
 *
 * IMPORT-TIME-001 / SV-I06 (mps-core/src/types.ts Timestamp doc): a Timestamp "SHALL NOT
 * participate in canonical identity, hashing, signing, or replay equality". `assertion.
 * asserted_at` is therefore excluded from both the identity hash and content_hash -- rerunning
 * this factory for the same fact at a different wall-clock moment must mint the same identity.
 */
export const DOCUMENT_FACT_CANDIDATE_CONTRACT_VERSION = "document-fact-candidate-v1" as const;

export interface DocumentFactCandidateInput {
  readonly fact_type: DocumentFactType;
  readonly fact_version: string;
  readonly source_document_ref: ContentReference;
  readonly inventory_ref: ContentReference;
  readonly source_span: DocumentFactSourceSpan;
  readonly subject_ref?: ContentReference;
  readonly asserted_by: ActorReference;
  readonly assertion_method: DocumentFactAssertionMethod;
  readonly asserter_version: string;
  /** Provenance only -- excluded from identity/content hashing, per IMPORT-TIME-001. */
  readonly asserted_at: string;
}

export interface DocumentFactCandidateSigner {
  readonly keyId: string;
  sign(bytes: Uint8Array): Promise<{ readonly signatureBase64: string }>;
}

/** The exact fields that determine identity. `asserted_at` is deliberately absent (IMPORT-TIME-001). */
function identityCore(input: DocumentFactCandidateInput): Record<string, unknown> {
  if (!isValidSpan(input.source_span)) {
    throw new Error(
      "REJECT_DOCUMENT_FACT_CANDIDATE: source_span is mandatory and must reference a text " +
        "projection with a non-empty, ordered offset range.",
    );
  }
  if (!input.source_document_ref?.id) {
    throw new Error("REJECT_DOCUMENT_FACT_CANDIDATE: source_document_ref is required");
  }
  if (!input.inventory_ref?.id) {
    throw new Error("REJECT_DOCUMENT_FACT_CANDIDATE: inventory_ref is required");
  }
  if (!input.asserted_by?.identity_ref?.id) {
    throw new Error("REJECT_DOCUMENT_FACT_CANDIDATE: asserted_by.identity_ref is required");
  }
  if (!input.asserter_version?.trim()) {
    throw new Error("REJECT_DOCUMENT_FACT_CANDIDATE: asserter_version is required");
  }

  return {
    artifact_type: "DOCUMENT_FACT_CANDIDATE",
    contract_version: DOCUMENT_FACT_CANDIDATE_CONTRACT_VERSION,
    verification_status: "CANDIDATE",
    fact_type: input.fact_type,
    fact_version: input.fact_version,
    source_document_ref: input.source_document_ref,
    inventory_ref: input.inventory_ref,
    source_span: input.source_span,
    // canonicalizeStrict forbids `undefined` values -- omit the key entirely rather than pass
    // it through, so an absent subject binds identically whether the caller wrote `undefined`
    // or left the field off.
    ...(input.subject_ref !== undefined ? { subject_ref: input.subject_ref } : {}),
    assertion: {
      asserted_by: input.asserted_by,
      assertion_method: input.assertion_method,
      asserter_version: input.asserter_version,
    },
  };
}

function sha256Hex(canonicalPayload: unknown): string {
  return createHash("sha256").update(Buffer.from(canonicalizeStrict(canonicalPayload), "utf8")).digest("hex");
}

/**
 * Deterministic identity hash, independent of `content_hash`/signature -- lets a caller compute
 * the identity a payload WOULD get before constructing the signed artifact (used by the RED
 * proof to assert "same source + span + semantics -> same identity" without needing a signer).
 */
export function computeDocumentFactCandidateIdentity(input: DocumentFactCandidateInput): string {
  return `fact-candidate-${sha256Hex(identityCore(input)).slice(0, 24)}`;
}

/**
 * Builds and signs a real `DocumentFactCandidateArtifact`. Pure aside from the injected signer
 * (no CAS write, no network, no verification) -- constructing a candidate is not admitting it
 * anywhere; that governance-owned admission path is a separate, later unit (ADR-27).
 */
export async function createDocumentFactCandidate(
  input: DocumentFactCandidateInput,
  signer: DocumentFactCandidateSigner,
): Promise<DocumentFactCandidateArtifact> {
  const core = identityCore(input);
  const artifactId = computeDocumentFactCandidateIdentity(input);

  const bare = { artifact_id: artifactId, ...core };
  const contentHash: HashDescriptor = { algorithm: "sha256", digest: sha256Hex(bare) };

  const signed = await signer.sign(Buffer.from(contentHash.digest, "hex"));
  const signature: SignatureDescriptor = {
    algorithm: "Ed25519",
    signature: `ed25519:${signed.signatureBase64}`,
    key_id: signer.keyId,
  };

  return {
    artifact_id: artifactId,
    artifact_type: "DOCUMENT_FACT_CANDIDATE",
    content_hash: contentHash,
    signature,
    verification_status: "CANDIDATE",
    fact_type: input.fact_type,
    fact_version: input.fact_version,
    source_document_ref: input.source_document_ref,
    inventory_ref: input.inventory_ref,
    source_span: input.source_span,
    subject_ref: input.subject_ref,
    assertion: {
      asserted_by: input.asserted_by,
      assertion_method: input.assertion_method,
      asserter_version: input.asserter_version,
      asserted_at: input.asserted_at,
    },
  };
}
