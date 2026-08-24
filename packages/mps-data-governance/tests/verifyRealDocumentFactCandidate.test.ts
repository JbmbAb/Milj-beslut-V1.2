import { describe, it, expect } from "vitest";
import {
  computeVerifiedDocumentFactIdentity,
  isVerifiedDocumentFactContentHashValid,
  verifyRealDocumentFactCandidate,
  type DocumentFactReviewInput,
  type DocumentFactReviewSigner,
} from "../src/verifyRealDocumentFactCandidate";
import { createDocumentFactCandidate, type DocumentFactCandidateSigner } from "../src/createDocumentFactCandidate";
import {
  DOCUMENT_FACT_VERIFICATION_POLICY_V1,
  DocumentFactVerificationError,
  type DocumentFactCandidateArtifact,
} from "../src/DocumentFactArtifact";
import type { ContentReference } from "../../mps-core/src/types";

/**
 * DOCUMENT-FACT-HUMAN-VERIFICATION-V1 -- RED proof requirements 1-7 from the frozen unit order.
 *
 * Deliberately offline, small deterministic input -- the real proof against the real Unit C
 * candidate (ff9ce938) is scripts/ops/prove-document-fact-human-verification-01.ts, which stops
 * before a real human decision and does not construct a VerifiedDocumentFactArtifact on its own.
 */
describe("DOCUMENT-FACT-HUMAN-VERIFICATION-V1: verifyRealDocumentFactCandidate", () => {
  const ref = (id: string): ContentReference => ({ id, content_hash: { algorithm: "sha256", digest: `hash-${id}` } });

  const extractorSigner: DocumentFactCandidateSigner = {
    keyId: "ed25519:test-extractor",
    async sign(bytes) {
      return { signatureBase64: `EXT:${Buffer.from(bytes).toString("base64").slice(0, 16)}` };
    },
  };
  const realReviewerSigner: DocumentFactReviewSigner = {
    keyId: "ed25519:test-reviewer",
    async sign(bytes) {
      return { signatureBase64: `REV:${Buffer.from(bytes).toString("base64").slice(0, 16)}` };
    },
  };

  async function realCandidate(): Promise<DocumentFactCandidateArtifact> {
    return createDocumentFactCandidate(
      {
        fact_type: "PRIOR_LOCATION_RESTRICTING_DECISION",
        fact_version: "1.0",
        source_document_ref: ref("mmod-doc-1"),
        inventory_ref: ref("mmod-doc-1"),
        source_span: { text_projection_ref: ref("proj-1"), start_offset: 646, end_offset: 758 },
        asserted_by: { identity_ref: ref("extractor-identity"), role: "SYSTEM_PROCESS" },
        assertion_method: "DETERMINISTIC_EXTRACTION",
        asserter_version: "document-fact-deterministic-span-extractor/v1",
        asserted_at: "2026-08-24T10:00:00.000Z",
      },
      extractorSigner,
    );
  }

  function reviewInput(
    candidate: DocumentFactCandidateArtifact,
    overrides: Partial<DocumentFactReviewInput> = {},
  ): DocumentFactReviewInput {
    return {
      candidate,
      verified_by: { identity_ref: ref("reviewer-identity"), role: "GOVERNANCE_REVIEWER" },
      verification_method: "HUMAN_REVIEW",
      policy: DOCUMENT_FACT_VERIFICATION_POLICY_V1,
      verified_at: "2026-08-24T11:00:00.000Z",
      ...overrides,
    };
  }

  it("RED-5: a real governance reviewer approving the exact real candidate -> VERIFIED", async () => {
    const candidate = await realCandidate();
    const verified = await verifyRealDocumentFactCandidate(reviewInput(candidate), realReviewerSigner);

    expect(verified.verification_status).toBe("VERIFIED");
    expect(verified.artifact_type).toBe("VERIFIED_DOCUMENT_FACT");
    expect(verified.candidate_ref.id).toBe(candidate.artifact_id);
    expect(verified.candidate_ref.content_hash.digest).toBe(candidate.content_hash.digest);
    expect(verified.source_span).toEqual(candidate.source_span);
    expect(verified.verification.verified_by.identity_ref.id).toBe("reviewer-identity");
    expect(verified.signature.key_id).toBe("ed25519:test-reviewer");
  });

  it("RED-1: the extractor cannot verify its own candidate -> DENY", async () => {
    const candidate = await realCandidate();
    await expect(
      verifyRealDocumentFactCandidate(
        reviewInput(candidate, {
          // Same identity_ref.id that asserted the candidate.
          verified_by: { identity_ref: ref("extractor-identity"), role: "GOVERNANCE_REVIEWER" },
        }),
        realReviewerSigner,
      ),
    ).rejects.toThrow(/may not verify its own fact/i);
  });

  it("a non-governance reviewer role is denied even under an admitted method", async () => {
    const candidate = await realCandidate();
    await expect(
      verifyRealDocumentFactCandidate(
        reviewInput(candidate, { verified_by: { identity_ref: ref("some-process"), role: "SYSTEM_PROCESS" } }),
        realReviewerSigner,
      ),
    ).rejects.toThrow(DocumentFactVerificationError);
  });

  it("RED-3/RED-4: a candidate whose content_hash no longer matches its own fields (tampered/changed span) -> DENY", async () => {
    const candidate = await realCandidate();
    const tampered: DocumentFactCandidateArtifact = {
      ...candidate,
      source_span: { ...candidate.source_span, start_offset: 0, end_offset: 48 },
    };
    await expect(verifyRealDocumentFactCandidate(reviewInput(tampered), realReviewerSigner)).rejects.toThrow(
      /candidate content_hash does not match its own carried fields/i,
    );
  });

  it("RED-3: a directly tampered content_hash digest is caught even if source_span looks untouched", async () => {
    const candidate = await realCandidate();
    const tampered: DocumentFactCandidateArtifact = {
      ...candidate,
      content_hash: { algorithm: "sha256", digest: "0".repeat(64) },
    };
    await expect(verifyRealDocumentFactCandidate(reviewInput(tampered), realReviewerSigner)).rejects.toThrow(
      /candidate content_hash does not match its own carried fields/i,
    );
  });

  it("RED-6: same candidate + same frozen review semantics -> deterministic verified identity, independent of verified_at", async () => {
    const candidate = await realCandidate();
    const a = await verifyRealDocumentFactCandidate(reviewInput(candidate, { verified_at: "2026-08-24T11:00:00.000Z" }), realReviewerSigner);
    const b = await verifyRealDocumentFactCandidate(reviewInput(candidate, { verified_at: "2027-01-01T00:00:00.000Z" }), realReviewerSigner);

    expect(a.artifact_id).toBe(b.artifact_id);
    expect(a.artifact_id).toBe(computeVerifiedDocumentFactIdentity(reviewInput(candidate)));
    expect(a.verification.verified_at).toBe("2026-08-24T11:00:00.000Z");
    expect(b.verification.verified_at).toBe("2027-01-01T00:00:00.000Z");
  });

  it("RED-7: the stamped policy version always reflects the exact policy actually checked against -- never hardcoded, never silently reinterpreted", async () => {
    const candidate = await realCandidate();
    const verifiedUnderV1 = await verifyRealDocumentFactCandidate(reviewInput(candidate), realReviewerSigner);
    expect(verifiedUnderV1.verification.verification_policy_version).toBe(DOCUMENT_FACT_VERIFICATION_POLICY_V1.policy_version);

    // A hypothetical future policy version is admitted on its own terms, not silently coerced to v1 --
    // this documents that the wrapper never hardcodes "document-fact-verification/v1" anywhere.
    const candidateB = await realCandidate();
    const futurePolicy = {
      policy_version: "document-fact-verification/v2",
      allowed_verification_methods: DOCUMENT_FACT_VERIFICATION_POLICY_V1.allowed_verification_methods,
    };
    const verifiedUnderV2 = await verifyRealDocumentFactCandidate(
      { ...reviewInput(candidateB), policy: futurePolicy },
      realReviewerSigner,
    );
    expect(verifiedUnderV2.verification.verification_policy_version).toBe("document-fact-verification/v2");
  });

  it("invariant: a machine-only verification method cannot verify PRIOR_LOCATION_RESTRICTING_DECISION under policy v1", async () => {
    const candidate = await realCandidate();
    await expect(
      verifyRealDocumentFactCandidate(
        reviewInput(candidate, {
          verification_method: "DETERMINISTIC_CLASSIFIER",
          verified_by: { identity_ref: ref("classifier-identity"), role: "SYSTEM_PROCESS" },
        }),
        realReviewerSigner,
      ),
    ).rejects.toThrow(DocumentFactVerificationError);
  });

  it("invariant: the reviewer signature is bound to the reviewer's own key, distinct from the extractor's key", async () => {
    const candidate = await realCandidate();
    const verified = await verifyRealDocumentFactCandidate(reviewInput(candidate), realReviewerSigner);
    expect(verified.signature.key_id).not.toBe(candidate.signature.key_id);
    expect(verified.signature.key_id).toBe("ed25519:test-reviewer");
    expect(candidate.signature.key_id).toBe("ed25519:test-extractor");
  });

  describe("DOCUMENT-FACT-HUMAN-VERIFICATION-APPROVED-V1: self-consistency + approval binding", () => {
    it("self-consistency: the VERIFIED artifact's content_hash is independently recomputable from its own carried fields alone", async () => {
      const candidate = await realCandidate();
      const verified = await verifyRealDocumentFactCandidate(reviewInput(candidate), realReviewerSigner);
      expect(isVerifiedDocumentFactContentHashValid(verified)).toBe(true);
    });

    it("RED-7: a VERIFIED artifact body altered after signing fails independent self-consistency verification", async () => {
      const candidate = await realCandidate();
      const verified = await verifyRealDocumentFactCandidate(reviewInput(candidate), realReviewerSigner);
      const tamperedBody = { ...verified, fact_version: "9.9" };
      expect(isVerifiedDocumentFactContentHashValid(tamperedBody)).toBe(false);
    });

    it("RED-8: a VERIFIED artifact whose reviewer identity/ref was changed after signing fails independent self-consistency verification", async () => {
      const candidate = await realCandidate();
      const verified = await verifyRealDocumentFactCandidate(reviewInput(candidate), realReviewerSigner);
      const tamperedReviewer = {
        ...verified,
        verification: { ...verified.verification, verified_by: { identity_ref: ref("someone-else"), role: "GOVERNANCE_REVIEWER" as const } },
      };
      expect(isVerifiedDocumentFactContentHashValid(tamperedReviewer)).toBe(false);
    });

    it("approval binds the EXACT candidate: two candidates for the same fact_type/document but different spans get independent, non-transferable verified identities", async () => {
      const approvedCandidate = await realCandidate();
      const rejectedShapeCandidate = await createDocumentFactCandidate(
        {
          fact_type: "PRIOR_LOCATION_RESTRICTING_DECISION",
          fact_version: "1.0",
          source_document_ref: ref("mmod-doc-1"),
          inventory_ref: ref("mmod-doc-1"),
          // A different span on the SAME document/fact_type -- e.g. the historically rejected one's shape.
          source_span: { text_projection_ref: ref("proj-1"), start_offset: 0, end_offset: 112 },
          asserted_by: { identity_ref: ref("extractor-identity"), role: "SYSTEM_PROCESS" },
          assertion_method: "DETERMINISTIC_EXTRACTION",
          asserter_version: "document-fact-deterministic-span-extractor/v1",
          asserted_at: "2026-08-24T10:00:00.000Z",
        },
        extractorSigner,
      );

      expect(approvedCandidate.artifact_id).not.toBe(rejectedShapeCandidate.artifact_id);

      const verified = await verifyRealDocumentFactCandidate(reviewInput(approvedCandidate), realReviewerSigner);

      // The verified artifact's candidate_ref binds ONLY the approved candidate -- same
      // fact_type, same source document, different span never counts as "the same fact".
      expect(verified.candidate_ref.id).toBe(approvedCandidate.artifact_id);
      expect(verified.candidate_ref.id).not.toBe(rejectedShapeCandidate.artifact_id);
      expect(verified.source_span).toEqual(approvedCandidate.source_span);
      expect(verified.source_span).not.toEqual(rejectedShapeCandidate.source_span);
    });
  });
});
