import { describe, it, expect } from "vitest";

import { LURuleEngine } from "../src/rules/LURuleEngine";
import type { DocumentEvidenceArtifact } from "../src/artifacts/DocumentEvidenceArtifact";
import type { ArtifactReference } from "@miljobeslut/mps-compliance/src/artifacts/ArtifactContract";
import type {
  DocumentFactCandidateArtifact,
  DocumentFactType,
  VerifiedDocumentFactArtifact,
} from "../../mps-data-governance/src/DocumentFactArtifact";

/**
 * ✅ F4B — `LU-DOC-BESLUT-001` GREEN PROOF.
 *
 *   Invariant under test:
 *     A finding SHALL arise from a VERIFIED document fact, and from nothing else.
 *
 *   Permitted:  text → classified fact → verification → canonical fact artifact → rule → finding
 *   Forbidden:  text → keyword → finding
 *
 *   The negative cases carry the weight here. A rule that fires on the right input is easy; the
 *   proof that matters is that it refuses every shortcut that would have produced the same
 *   finding for the wrong reason — in particular a document typed "decision", and text
 *   containing "avslag", with no verified fact behind either.
 *
 *   @see packages/mps-data-governance/src/DocumentFactArtifact.ts (OWNER FREEZE 2026-08-12)
 *   @see docs/architecture/F4B-DOCUMENT-FACT-MODEL-CHECK-2026-08-12.md
 */
describe("F4B — LU-DOC-BESLUT-001 fires on verified facts only (GREEN PROOF)", () => {
  const BESLUT: DocumentFactType = "PRIOR_LOCATION_RESTRICTING_DECISION";

  function ref(id: string, type: string): ArtifactReference {
    return { artifact_id: id, artifact_type: type };
  }

  function contentRef(id: string) {
    return { id, content_hash: { algorithm: "sha256", digest: `hash-${id}` } };
  }

  function factCore(id: string, factType: DocumentFactType) {
    return {
      artifact_id: id,
      content_hash: { algorithm: "sha256", digest: `hash-${id}` },
      signature: { algorithm: "ed25519", signature: `sig-${id}` },
      fact_type: factType,
      fact_version: "1.0",
      source_document_ref: contentRef("doc-f4b"),
      inventory_ref: contentRef("inv-f4b"),
      source_span: {
        text_projection_ref: contentRef("proj-f4b"),
        start_offset: 10,
        end_offset: 64,
      },
      subject_ref: contentRef("prop-f4b"),
      assertion: {
        asserted_by: { identity_ref: contentRef("extractor-1"), role: "SYSTEM_PROCESS" as const },
        assertion_method: "MODEL_EXTRACTION" as const,
        asserter_version: "extractor/1.4.0",
        asserted_at: "2026-08-12T09:00:00.000Z",
      },
    };
  }

  function verifiedFact(id: string, factType: DocumentFactType = BESLUT): VerifiedDocumentFactArtifact {
    return {
      ...factCore(id, factType),
      artifact_type: "VERIFIED_DOCUMENT_FACT",
      verification_status: "VERIFIED",
      candidate_ref: contentRef(`cand-${id}`),
      verification: {
        verified_by: { identity_ref: contentRef("reviewer-1"), role: "GOVERNANCE_REVIEWER" as const },
        verification_method: "HUMAN_REVIEW" as const,
        verification_policy_version: "document-fact-verification/v1",
        verified_at: "2026-08-12T10:00:00.000Z",
      },
    };
  }

  function candidateFact(id: string, factType: DocumentFactType = BESLUT): DocumentFactCandidateArtifact {
    return {
      ...factCore(id, factType),
      artifact_type: "DOCUMENT_FACT_CANDIDATE",
      verification_status: "CANDIDATE",
    };
  }

  /**
   * The evidence is deliberately built to look maximally like a "hit" to every forbidden
   * shortcut: type `"decision"`, an authority, and a title containing "avslag". Only
   * `fact_refs` varies between the positive and negative cases.
   */
  function documentEvidence(id: string, factRefs: ArtifactReference[]): DocumentEvidenceArtifact {
    return {
      artifact_id: id,
      artifact_type: "DOCUMENT_EVIDENCE",
      content_hash: { algorithm: "sha256", value: `hash-${id}` },
      payload: {
        property_ref: ref("prop-f4b", "PROPERTY"),
        document_ref: ref("doc-f4b", "DOCUMENT"),
        relevant_document: {
          title: "Beslut om avslag — lokalisering",
          type: "decision",
          metadata: { source_url: "file:///f4b/avslag.txt", authority: "Länsstyrelsen" },
        },
        fact_refs: factRefs,
        text_projection_ref: ref("proj-f4b", "TEXT_PROJECTION"),
        raw_source_ref: ref("raw-f4b", "RAW_SOURCE_ARTIFACT"),
        source_metadata: { provider: "Länsstyrelsen", retrieved_at: "2026-08-12T08:00:00.000Z" },
      },
    } as unknown as DocumentEvidenceArtifact;
  }

  function evaluate(
    evidence: DocumentEvidenceArtifact,
    facts: readonly VerifiedDocumentFactArtifact[],
  ) {
    return new LURuleEngine()
      .evaluate({ spatial_evidence: [], document_evidence: [evidence], verified_document_facts: facts })
      .filter((f) => f.rule_id === "LU-DOC-BESLUT-001");
  }

  // ---------------------------------------------------------------- POSITIVE

  it("VERIFIED matching fact → finding CREATED, bound to canonical evidence and fact provenance", () => {
    const fact = verifiedFact("fact-verified-1");
    const evidence = documentEvidence("ev-positive", [ref(fact.artifact_id, "VERIFIED_DOCUMENT_FACT")]);

    const findings = evaluate(evidence, [fact]);

    expect(findings).toHaveLength(1);
    expect(findings[0].rule_id).toBe("LU-DOC-BESLUT-001");
    expect(findings[0].rule_version).toBe("1.0");

    const boundIds = findings[0].evidence_refs.map((r) => r.artifact_id);
    expect(
      boundIds,
      "F4B: the finding must bind back to BOTH the evidence artifact and the verified fact. " +
        "Dropping the fact reference would leave the legal conclusion untraceable to its basis.",
    ).toEqual(expect.arrayContaining(["ev-positive", "fact-verified-1"]));

    const factRef = findings[0].evidence_refs.find((r) => r.artifact_id === "fact-verified-1");
    expect(factRef!.artifact_type).toBe("VERIFIED_DOCUMENT_FACT");
  });

  // ---------------------------------------------------------------- NEGATIVE

  it("CANDIDATE matching fact → NO finding", () => {
    const candidate = candidateFact("fact-candidate-1");
    const evidence = documentEvidence("ev-candidate", [
      ref(candidate.artifact_id, "DOCUMENT_FACT_CANDIDATE"),
    ]);

    // Cast is the point of the test: the compiler already rejects a candidate here, so this
    // simulates a boundary where the type was erased (DB read, JSON transport) and only the
    // runtime guard stands between a machine assertion and a legal finding.
    const findings = evaluate(evidence, [candidate as unknown as VerifiedDocumentFactArtifact]);

    expect(
      findings,
      "F4B: a CANDIDATE is a machine assertion, not a legal fact. Asserting is not verifying. " +
        "If this fires, unverified model output can produce a legal finding.",
    ).toHaveLength(0);
  });

  it("VERIFIED non-matching fact → NO finding", () => {
    // The vocabulary currently has exactly one member, so a non-matching type must be forced.
    // This is a forward guard: when DocumentFactType grows, the rule must not widen with it.
    const otherType = "PRIOR_UNRELATED_DECISION" as unknown as DocumentFactType;
    const fact = verifiedFact("fact-other-type", otherType);
    const evidence = documentEvidence("ev-other-type", [
      ref(fact.artifact_id, "VERIFIED_DOCUMENT_FACT"),
    ]);

    const findings = evaluate(evidence, [fact]);

    expect(
      findings,
      "F4B: verification alone is not the predicate. The fact must also be of the type the rule " +
        "is about, or the rule fires on any verified fact whatsoever.",
    ).toHaveLength(0);
  });

  it('RelevantDocument.type = "decision" without a verified fact → NO finding', () => {
    const evidence = documentEvidence("ev-type-only", []);

    const findings = evaluate(evidence, []);

    expect(
      findings,
      "F4B: RelevantDocument.type describes what the document IS, never what it MEANS. " +
        "Predicating on it would restore document-class-as-legal-fact.",
    ).toHaveLength(0);
  });

  it('text containing "avslag" without a verified fact → NO finding (keyword-shortcut regression guard)', () => {
    // The strongest regression guard in this suite. Title, metadata and document type all shout
    // "this is a rejection decision" — and the rule must stay silent, because nothing here has
    // been verified by anyone.
    const evidence = documentEvidence("ev-keyword", []);
    expect(evidence.payload.relevant_document.title).toContain("avslag");

    const findings = evaluate(evidence, []);

    expect(
      findings,
      "F4B: this is the original dangerous shortcut — text → keyword → legal finding. If this " +
        "fires, the fact model has been bypassed and the rule is reading text again.",
    ).toHaveLength(0);
  });

  // ---------------------------------------------------------------- STRUCTURAL

  it("a fact_ref that resolves to nothing → NO finding (absent facts are not unchecked facts)", () => {
    const evidence = documentEvidence("ev-dangling", [ref("fact-missing", "VERIFIED_DOCUMENT_FACT")]);

    const findings = evaluate(evidence, []);

    expect(
      findings,
      "F4B: an unresolvable reference must fail closed. Firing on the reference alone would make " +
        "the predicate 'a fact was claimed' rather than 'a fact was verified'.",
    ).toHaveLength(0);
  });

  it("omitting verified_document_facts entirely → NO finding", () => {
    const fact = verifiedFact("fact-omitted");
    const evidence = documentEvidence("ev-omitted", [ref(fact.artifact_id, "VERIFIED_DOCUMENT_FACT")]);

    const findings = new LURuleEngine()
      .evaluate({ spatial_evidence: [], document_evidence: [evidence] })
      .filter((f) => f.rule_id === "LU-DOC-BESLUT-001");

    expect(
      findings,
      "F4B: absent facts must mean 'no finding', never 'unchecked'.",
    ).toHaveLength(0);
  });

  it("risk calibration v1 — the finding signals material relevance, not HIGH risk", () => {
    const fact = verifiedFact("fact-risk");
    const evidence = documentEvidence("ev-risk", [ref(fact.artifact_id, "VERIFIED_DOCUMENT_FACT")]);

    const findings = evaluate(evidence, [fact]);

    expect(
      findings[0].risk_level,
      "OWNER FREEZE 2026-08-13: PRIOR_LOCATION_RESTRICTING_DECISION signals material relevance " +
        "and does not by itself establish HIGH risk. Grading a bare existence claim as HIGH " +
        "would inflate every such finding and erode the distinction.",
    ).toBe("MEDIUM");
  });

  it("the finding cites the fact type and never document text", () => {
    const fact = verifiedFact("fact-explanation");
    const evidence = documentEvidence("ev-explanation", [
      ref(fact.artifact_id, "VERIFIED_DOCUMENT_FACT"),
    ]);

    const findings = evaluate(evidence, [fact]);

    expect(findings[0].explanation).toContain("PRIOR_LOCATION_RESTRICTING_DECISION");
    expect(
      findings[0].explanation.toLowerCase(),
      "F4B: the explanation must not quote the document. Copying text into the finding would " +
        "reintroduce loose text on the far side of the model it was removed from.",
    ).not.toContain("avslag");
  });
});
