import { describe, it, expect } from "vitest";
import {
  computeDocumentFactCandidateIdentity,
  createDocumentFactCandidate,
  type DocumentFactCandidateInput,
  type DocumentFactCandidateSigner,
} from "../src/createDocumentFactCandidate";
import type { ContentReference } from "../../mps-core/src/types";

/**
 * DOCUMENT-FACT-CANDIDATE-V1 -- RED proof requirements 1-8 from the frozen unit order.
 *
 * Deliberately offline: exercises the pure factory against small deterministic input, not the
 * real MMOD document (that is scripts/ops/prove-document-fact-candidate-01.ts, which reuses the
 * exact same factory against the real Unit A/B source/projection chain).
 */
describe("DOCUMENT-FACT-CANDIDATE-V1: createDocumentFactCandidate", () => {
  const ref = (id: string): ContentReference => ({
    id,
    content_hash: { algorithm: "sha256", digest: `hash-${id}` },
  });

  const stubSigner: DocumentFactCandidateSigner = {
    keyId: "ed25519:test-extractor",
    async sign(bytes) {
      return { signatureBase64: Buffer.from(bytes).toString("base64").slice(0, 24) };
    },
  };

  function baseInput(overrides: Partial<DocumentFactCandidateInput> = {}): DocumentFactCandidateInput {
    return {
      fact_type: "PRIOR_LOCATION_RESTRICTING_DECISION",
      fact_version: "1.0",
      source_document_ref: ref("mmod-doc-1"),
      inventory_ref: ref("mmod-doc-1"),
      source_span: { text_projection_ref: ref("proj-1"), start_offset: 646, end_offset: 758 },
      asserted_by: { identity_ref: ref("extractor-identity"), role: "SYSTEM_PROCESS" },
      assertion_method: "DETERMINISTIC_EXTRACTION",
      asserter_version: "document-fact-deterministic-span-extractor/v1",
      asserted_at: "2026-08-24T10:00:00.000Z",
      ...overrides,
    };
  }

  it("RED-1: same source + same span + same fact semantics -> same candidate identity, even at a different wall-clock timestamp (IMPORT-TIME-001)", async () => {
    const a = await createDocumentFactCandidate(baseInput({ asserted_at: "2026-08-24T10:00:00.000Z" }), stubSigner);
    const b = await createDocumentFactCandidate(baseInput({ asserted_at: "2027-01-01T00:00:00.000Z" }), stubSigner);

    expect(a.artifact_id).toBe(b.artifact_id);
    expect(a.artifact_id).toBe(computeDocumentFactCandidateIdentity(baseInput()));
    // Provenance timestamp is still carried, just not identity-bearing.
    expect(a.assertion.asserted_at).toBe("2026-08-24T10:00:00.000Z");
    expect(b.assertion.asserted_at).toBe("2027-01-01T00:00:00.000Z");
  });

  it("RED-2: changing the source span changes identity", async () => {
    const a = await createDocumentFactCandidate(baseInput(), stubSigner);
    const b = await createDocumentFactCandidate(
      baseInput({ source_span: { text_projection_ref: ref("proj-1"), start_offset: 0, end_offset: 48 } }),
      stubSigner,
    );
    expect(a.artifact_id).not.toBe(b.artifact_id);
  });

  it("RED-3: changing the source artifact/projection changes identity", async () => {
    const a = await createDocumentFactCandidate(baseInput(), stubSigner);
    const b = await createDocumentFactCandidate(
      baseInput({ source_document_ref: ref("mmod-doc-2") }),
      stubSigner,
    );
    const c = await createDocumentFactCandidate(
      baseInput({ source_span: { text_projection_ref: ref("proj-2"), start_offset: 646, end_offset: 758 } }),
      stubSigner,
    );
    expect(a.artifact_id).not.toBe(b.artifact_id);
    expect(a.artifact_id).not.toBe(c.artifact_id);
  });

  it("RED-4: a malformed/out-of-range span fails closed", async () => {
    await expect(
      createDocumentFactCandidate(
        baseInput({ source_span: { text_projection_ref: ref("proj-1"), start_offset: 758, end_offset: 646 } }),
        stubSigner,
      ),
    ).rejects.toThrow(/source_span is mandatory/i);

    await expect(
      createDocumentFactCandidate(
        baseInput({ source_span: { text_projection_ref: { id: "" } as ContentReference, start_offset: 0, end_offset: 10 } }),
        stubSigner,
      ),
    ).rejects.toThrow(/source_span is mandatory/i);
  });

  it("RED-5: the candidate is traceable back to its source artifact, projection, and exact text span", async () => {
    const candidate = await createDocumentFactCandidate(baseInput(), stubSigner);
    expect(candidate.source_document_ref.id).toBe("mmod-doc-1");
    expect(candidate.source_span.text_projection_ref.id).toBe("proj-1");
    expect(candidate.source_span.start_offset).toBe(646);
    expect(candidate.source_span.end_offset).toBe(758);
  });

  it("RED-8 / invariant: the candidate is signed by the asserting identity, stays a CANDIDATE, and is never self-verified", async () => {
    const candidate = await createDocumentFactCandidate(baseInput(), stubSigner);
    expect(candidate.verification_status).toBe("CANDIDATE");
    expect(candidate.artifact_type).toBe("DOCUMENT_FACT_CANDIDATE");
    expect(candidate.signature.key_id).toBe("ed25519:test-extractor");
    expect(candidate.signature.signature).toMatch(/^ed25519:/);
    expect(candidate.content_hash.digest).toMatch(/^[0-9a-f]{64}$/);
    // No verification field exists on a candidate -- the type itself forbids it.
    expect((candidate as unknown as Record<string, unknown>).verification).toBeUndefined();
  });

  it("invariant: an unsupported fact type is rejected structurally by the type system, and policy v1 admits exactly one", async () => {
    // PRIOR_LOCATION_RESTRICTING_DECISION is the ONLY fact type in the frozen vocabulary
    // (DocumentFactArtifact.ts) -- this test documents that closed vocabulary rather than
    // re-asserting DOCUMENT_FACT_VERIFICATION_POLICY_V1's own coverage (already proven by
    // DocumentFactModel.test.ts).
    const candidate = await createDocumentFactCandidate(baseInput(), stubSigner);
    expect(candidate.fact_type).toBe("PRIOR_LOCATION_RESTRICTING_DECISION");
  });
});
