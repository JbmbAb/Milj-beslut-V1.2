import { describe, it, expect } from "vitest";
import { LURuleEngine } from "../src/rules/LURuleEngine";
import { createDocumentEvidenceArtifactV2, type DocumentEvidenceHashedRef } from "../src/artifacts/DocumentEvidenceArtifactV2";
import { createDocumentFactCandidate, type DocumentFactCandidateSigner } from "../../mps-data-governance/src/createDocumentFactCandidate";
import { verifyRealDocumentFactCandidate, type DocumentFactReviewSigner } from "../../mps-data-governance/src/verifyRealDocumentFactCandidate";
import { DOCUMENT_FACT_VERIFICATION_POLICY_V1 } from "../../mps-data-governance/src/DocumentFactArtifact";
import type { ContentReference } from "../../mps-core/src/types";

/**
 * LU-DOCUMENT-EVIDENCE-WIRING-V1 -- narrow engine fix.
 *
 * LURuleEngine's LU-DOC-BESLUT-001 predicate read `payload.fact_refs` (the V1 field name) even
 * against a real V2 DocumentEvidenceArtifact, whose payload carries `verified_fact_refs`
 * instead -- a different field, not a renamed alias. Fed a real V2 artifact, the rule silently
 * never fired for ANY content, because `ev.payload.fact_refs` is simply `undefined` on a V2
 * object. This test proves the fix: version-dispatched reading, V1 behavior unchanged.
 *
 * Built through the real constructors (createDocumentFactCandidate,
 * verifyRealDocumentFactCandidate, createDocumentEvidenceArtifactV2), not a hand-typed fixture --
 * the real hash domains are what exercise the real code path.
 */
describe("LURuleEngine: LU-DOC-BESLUT-001 against real V2 DocumentEvidence", () => {
  const ref = (id: string): ContentReference => ({ id, content_hash: { algorithm: "sha256", digest: `hash-${id}` } });

  const extractorSigner: DocumentFactCandidateSigner = {
    keyId: "ed25519:test-extractor",
    async sign(bytes) {
      return { signatureBase64: Buffer.from(bytes).toString("base64").slice(0, 16) };
    },
  };
  const reviewerSigner: DocumentFactReviewSigner = {
    keyId: "ed25519:test-reviewer",
    async sign(bytes) {
      return { signatureBase64: Buffer.from(bytes).toString("base64").slice(0, 16) };
    },
  };

  async function buildVerifiedFact(factType: "PRIOR_LOCATION_RESTRICTING_DECISION" = "PRIOR_LOCATION_RESTRICTING_DECISION") {
    const candidate = await createDocumentFactCandidate(
      {
        fact_type: factType,
        fact_version: "1.0",
        source_document_ref: ref("doc-1"),
        inventory_ref: ref("doc-1"),
        source_span: { text_projection_ref: ref("proj-1"), start_offset: 0, end_offset: 48 },
        asserted_by: { identity_ref: ref("extractor-identity"), role: "SYSTEM_PROCESS" },
        assertion_method: "DETERMINISTIC_EXTRACTION",
        asserter_version: "test-extractor/v1",
        asserted_at: "2026-08-24T10:00:00.000Z",
      },
      extractorSigner,
    );
    return verifyRealDocumentFactCandidate(
      {
        candidate,
        verified_by: { identity_ref: ref("reviewer-identity"), role: "GOVERNANCE_REVIEWER" },
        verification_method: "HUMAN_REVIEW",
        policy: DOCUMENT_FACT_VERIFICATION_POLICY_V1,
        verified_at: "2026-08-24T11:00:00.000Z",
      },
      reviewerSigner,
    );
  }

  it("fires LU-DOC-BESLUT-001 for real V2 evidence referencing a matching verified fact", async () => {
    const fact = await buildVerifiedFact();
    const factRef: DocumentEvidenceHashedRef = { artifact_id: fact.artifact_id, artifact_type: fact.artifact_type, content_hash: fact.content_hash.digest };
    const evidence = createDocumentEvidenceArtifactV2({
      document_ref: { artifact_id: "doc-1", artifact_type: "RAW_SOURCE", content_hash: "hash-doc-1" },
      verified_fact_refs: [factRef],
      source_metadata: { provider: "test", retrieved_at: "2026-08-24T12:00:00.000Z" },
    });

    const engine = new LURuleEngine();
    const findings = engine.evaluate({
      spatial_evidence: [],
      document_evidence: [evidence],
      verified_document_facts: [fact],
    });

    const docFinding = findings.find((f) => f.rule_id === "LU-DOC-BESLUT-001");
    expect(docFinding).toBeDefined();
    expect(docFinding?.evidence_refs.map((r) => r.artifact_id)).toEqual(
      expect.arrayContaining([evidence.artifact_id, fact.artifact_id]),
    );
  });

  it("does not fire for V2 evidence whose verified_fact_refs do not resolve to a matching fact", async () => {
    const evidence = createDocumentEvidenceArtifactV2({
      document_ref: { artifact_id: "doc-2", artifact_type: "RAW_SOURCE", content_hash: "hash-doc-2" },
      verified_fact_refs: [{ artifact_id: "fact-not-supplied", artifact_type: "VERIFIED_DOCUMENT_FACT", content_hash: "x" }],
      source_metadata: { provider: "test", retrieved_at: "2026-08-24T12:00:00.000Z" },
    });

    const engine = new LURuleEngine();
    const findings = engine.evaluate({ spatial_evidence: [], document_evidence: [evidence], verified_document_facts: [] });
    expect(findings.find((f) => f.rule_id === "LU-DOC-BESLUT-001")).toBeUndefined();
  });
});
