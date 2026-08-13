import { describe, it, expect } from "vitest";

import {
  DOCUMENT_FACT_VERIFICATION_POLICY_V1,
  DocumentFactVerificationError,
  isValidSpan,
  isVerifiedDocumentFact,
  verifyDocumentFactCandidate,
  type DocumentFactCandidateArtifact,
  type DocumentFactSourceSpan,
  type DocumentFactVerification,
  type DocumentFactVerificationPolicy,
} from "../src/DocumentFactArtifact";
import type { ContentReference } from "../../mps-core/src/types";

/**
 * ✅ F4B-0 — DOCUMENT FACT MODEL GREEN PROOF.
 *
 *   Measurement point is the DOCUMENT FACT CONTRACT — exactly as F4A's measurement point was
 *   the transport contract. `LU-DOC-BESLUT-001` is NOT required to be green here; that is F4B.
 *
 *   Proves:
 *     machine/extractor        → CANDIDATE fact
 *     CANDIDATE                ≠ VERIFIED
 *     verification by explicit versioned method → VERIFIED DocumentFactArtifact
 *     VERIFIED fact            → referenceable by DocumentEvidence
 *     source_span              → mandatory and identity-bound
 *     raw text / document type / free metadata → CANNOT alone create a VERIFIED fact
 *
 *   @see docs/architecture/F4B-DOCUMENT-FACT-MODEL-CHECK-2026-08-12.md (OWNER FREEZE)
 *   @see docs/architecture/mimers-brunn-v3.0.0.md §3.3 (Tier 3 Inventory)
 */
describe("F4B-0 — Document Fact Model (GREEN PROOF)", () => {
  const ref = (id: string): ContentReference => ({
    id,
    content_hash: { algorithm: "sha256", digest: `hash-${id}` },
  });

  const span: DocumentFactSourceSpan = {
    text_projection_ref: ref("text-projection-1"),
    start_offset: 120,
    end_offset: 260,
  };

  function candidate(
    overrides: Partial<DocumentFactCandidateArtifact> = {},
  ): DocumentFactCandidateArtifact {
    return {
      artifact_id: "fact-cand-1",
      artifact_type: "DOCUMENT_FACT_CANDIDATE",
      content_hash: { algorithm: "sha256", digest: "hash-cand-1" },
      signature: { algorithm: "ed25519", signature: "sig-cand-1", key_id: "k1" },
      verification_status: "CANDIDATE",
      fact_type: "PRIOR_LOCATION_RESTRICTING_DECISION",
      fact_version: "1.0",
      source_document_ref: ref("doc-1"),
      inventory_ref: ref("inventory-1"),
      source_span: span,
      assertion: {
        asserted_by: { identity_ref: ref("extractor-identity"), role: "SYSTEM_PROCESS" },
        assertion_method: "MODEL_EXTRACTION",
        asserter_version: "legal-fact-extractor/0.3.1",
        asserted_at: "2026-08-12T07:00:00Z",
      },
      ...overrides,
    } as DocumentFactCandidateArtifact;
  }

  function humanVerification(
    overrides: Partial<DocumentFactVerification> = {},
  ): DocumentFactVerification {
    return {
      verified_by: { identity_ref: ref("reviewer-identity"), role: "GOVERNANCE_REVIEWER" },
      verification_method: "HUMAN_REVIEW",
      verification_policy_version: DOCUMENT_FACT_VERIFICATION_POLICY_V1.policy_version,
      verified_at: "2026-08-12T08:00:00Z",
      ...overrides,
    };
  }

  function verify(
    c: DocumentFactCandidateArtifact,
    v: DocumentFactVerification,
    policy: DocumentFactVerificationPolicy = DOCUMENT_FACT_VERIFICATION_POLICY_V1,
  ) {
    return verifyDocumentFactCandidate({
      candidate: c,
      candidate_ref: ref(c.artifact_id),
      verification: v,
      policy,
      artifact_id: "fact-verified-1",
      content_hash: { algorithm: "sha256", digest: "hash-verified-1" },
      signature: { algorithm: "ed25519", signature: "sig-verified-1", key_id: "k1" },
    });
  }

  describe("1. A machine may assert a CANDIDATE — and a CANDIDATE is not a fact", () => {
    it("a candidate carries its assertion origin but is not VERIFIED", () => {
      const c = candidate();

      expect(c.verification_status).toBe("CANDIDATE");
      expect(c.assertion.assertion_method).toBe("MODEL_EXTRACTION");
      expect(c.assertion.asserter_version).toBe("legal-fact-extractor/0.3.1");

      expect(
        isVerifiedDocumentFact(c),
        "F4B-0: a CANDIDATE must never satisfy the verified-fact guard. Rules consume VERIFIED only.",
      ).toBe(false);
    });
  });

  describe("2. Verification requires an explicit, policy-admitted, versioned method", () => {
    it("human review promotes CANDIDATE to VERIFIED and preserves the assertion origin", () => {
      const c = candidate();
      const verified = verify(c, humanVerification());

      expect(verified.artifact_type).toBe("VERIFIED_DOCUMENT_FACT");
      expect(verified.verification_status).toBe("VERIFIED");
      expect(isVerifiedDocumentFact(verified)).toBe(true);

      // Assertion origin is never discarded — otherwise the fact becomes unauditable.
      expect(verified.assertion.assertion_method).toBe("MODEL_EXTRACTION");
      expect(verified.candidate_ref.id).toBe("fact-cand-1");
      expect(verified.verification.verification_policy_version).toBe(
        "document-fact-verification/v1",
      );
    });

    it("a machine-only method cannot verify PRIOR_LOCATION_RESTRICTING_DECISION under policy v1", () => {
      const c = candidate();
      expect(() =>
        verify(
          c,
          humanVerification({
            verification_method: "DETERMINISTIC_CLASSIFIER",
            verified_by: { identity_ref: ref("classifier-identity"), role: "SYSTEM_PROCESS" },
          }),
        ),
        "F4B-0: an extractor/model must not alone make a legal fact VERIFIED unless a frozen " +
          "policy explicitly admits that method for that fact type.",
      ).toThrow(DocumentFactVerificationError);
    });

    it("a non-governance verifier is rejected even with an admitted method", () => {
      const c = candidate();
      expect(() =>
        verify(
          c,
          humanVerification({
            verified_by: { identity_ref: ref("some-process"), role: "SYSTEM_PROCESS" },
          }),
        ),
      ).toThrow(/requires a governance\/human verifier/i);
    });

    it("the asserter may not verify its own fact", () => {
      const c = candidate();
      expect(() =>
        verify(
          c,
          humanVerification({
            verified_by: { identity_ref: ref("extractor-identity"), role: "GOVERNANCE_REVIEWER" },
          }),
        ),
        "F4B-0: assertion and verification must be separate identities, otherwise verification " +
          "is self-attestation.",
      ).toThrow(/may not verify its own fact/i);
    });

    it("a verification citing a different policy version than the one checked is rejected", () => {
      const c = candidate();
      expect(() =>
        verify(c, humanVerification({ verification_policy_version: "document-fact-verification/v0" })),
      ).toThrow(/cites policy/i);
    });

    it("an already-verified artifact cannot be re-verified as if it were a candidate", () => {
      // The type system already forbids this state — the cast simulates a runtime value that
      // slipped past the type boundary (e.g. deserialized from storage).
      const c = candidate({ verification_status: "VERIFIED" } as unknown as Partial<DocumentFactCandidateArtifact>);
      expect(() => verify(c, humanVerification())).toThrow(/only a CANDIDATE may be verified/i);
    });
  });

  describe("3. source_span is mandatory and identity-bound", () => {
    it("rejects a candidate whose span has no text projection reference", () => {
      const c = candidate({
        source_span: { ...span, text_projection_ref: { id: "" } as ContentReference },
      });
      expect(() => verify(c, humanVerification())).toThrow(/source_span is mandatory/i);
    });

    it("rejects a degenerate or inverted offset range", () => {
      expect(isValidSpan({ ...span, start_offset: 260, end_offset: 120 })).toBe(false);
      expect(isValidSpan({ ...span, start_offset: 100, end_offset: 100 })).toBe(false);
      expect(isValidSpan({ ...span, start_offset: -1, end_offset: 10 })).toBe(false);
      expect(isValidSpan(undefined)).toBe(false);
      expect(isValidSpan(span)).toBe(true);
    });

    it("a verified fact carries the span forward — the passage stays traceable", () => {
      const verified = verify(candidate(), humanVerification());
      expect(verified.source_span.text_projection_ref.id).toBe("text-projection-1");
      expect(verified.source_span.start_offset).toBe(120);
      expect(verified.source_span.end_offset).toBe(260);
    });
  });

  describe("4. Raw text, document type and free metadata cannot alone create a VERIFIED fact", () => {
    it("the fact model exposes no field that accepts document text or untyped metadata", () => {
      const verified = verify(candidate(), humanVerification());
      const keys = Object.keys(verified);

      const forbidden = keys.filter((k) =>
        ["text", "text_content", "metadata", "keywords", "raw_text", "excerpt"].includes(k),
      );

      expect(
        forbidden,
        "F4B-0: a legal fact must not carry loose text or untyped metadata. Its content is the " +
          "typed claim plus its provenance; the passage is referenced, never copied in.",
      ).toEqual([]);
    });

    it("a fact type is a claim, not a document class — the vocabulary is closed and versioned", () => {
      const verified = verify(candidate(), humanVerification());
      expect(verified.fact_type).toBe("PRIOR_LOCATION_RESTRICTING_DECISION");
      expect(verified.fact_version).toBe("1.0");

      // A document class such as "decision" is not a fact type. Policy v1 admits exactly one
      // fact type, so any smuggled-in class would have no admitted verification method.
      const policyKeys = Object.keys(
        DOCUMENT_FACT_VERIFICATION_POLICY_V1.allowed_verification_methods,
      );
      expect(policyKeys).toEqual(["PRIOR_LOCATION_RESTRICTING_DECISION"]);
      expect(policyKeys).not.toContain("decision");
    });
  });

  describe("5. A VERIFIED fact is referenceable by DocumentEvidence", () => {
    it("exposes a canonical artifact identity that DocumentEvidence.fact_refs can bind to", () => {
      const verified = verify(candidate(), humanVerification());

      // DocumentEvidence references facts; it does not own them.
      const factRef = {
        artifact_id: verified.artifact_id,
        artifact_type: verified.artifact_type,
      };

      expect(factRef.artifact_id).toBe("fact-verified-1");
      expect(factRef.artifact_type).toBe("VERIFIED_DOCUMENT_FACT");
      expect(
        factRef.artifact_type,
        "F4B-0: DocumentEvidence must never reference a CANDIDATE as if it were a legal fact.",
      ).not.toBe("DOCUMENT_FACT_CANDIDATE");

      // The fact stays bound to Tier 3 and to the document it is about — this is what makes it
      // reusable across LU projects instead of re-classified per project.
      expect(verified.inventory_ref.id).toBe("inventory-1");
      expect(verified.source_document_ref.id).toBe("doc-1");
    });
  });
});
