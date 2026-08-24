import { describe, it, expect } from "vitest";
import { resolveEvidence } from "../src/execution/LuDeterministicReExecution";
import { InMemoryArtifactRepository } from "../../mps-runtime/src/repository/InMemoryArtifactRepository";
import { createDocumentEvidenceArtifactV2, type DocumentEvidenceHashedRef } from "../src/artifacts/DocumentEvidenceArtifactV2";
import { createDocumentFactCandidate, type DocumentFactCandidateSigner } from "../../mps-data-governance/src/createDocumentFactCandidate";
import { verifyRealDocumentFactCandidate, type DocumentFactReviewSigner } from "../../mps-data-governance/src/verifyRealDocumentFactCandidate";
import { DOCUMENT_FACT_VERIFICATION_POLICY_V1 } from "../../mps-data-governance/src/DocumentFactArtifact";
import type { ContentReference } from "../../mps-core/src/types";
import type { VerifiedDocumentFactArtifact } from "../../mps-data-governance/src/DocumentFactArtifact";
import type { DocumentEvidenceArtifact } from "../src/artifacts/DocumentEvidenceArtifact";

/**
 * H15-DOCUMENT-EVIDENCE-REHASH-COLD-REPLAY-V1 -- RED proof requirements 1-10.
 *
 * Deliberately offline, small deterministic input built through the REAL constructors
 * (createDocumentFactCandidate, verifyRealDocumentFactCandidate, createDocumentEvidenceArtifactV2)
 * so the tampering proofs exercise the real hash domains, not a hand-typed fixture. The real
 * proof against the real CAS-admitted artifact (doc-evidence-v2-ccef28ba76dc7cca7fa6ca85, commit
 * 27fd3a38) is scripts/ops/prove-h15-document-evidence-rehash-cold-replay-01.ts.
 */
describe("H15-DOCUMENT-EVIDENCE-REHASH-COLD-REPLAY-V1: resolveEvidence", () => {
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

  async function buildRealVerifiedFact(): Promise<VerifiedDocumentFactArtifact> {
    const candidate = await createDocumentFactCandidate(
      {
        fact_type: "PRIOR_LOCATION_RESTRICTING_DECISION",
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

  function buildRealV2Evidence(fact: VerifiedDocumentFactArtifact) {
    const factRef: DocumentEvidenceHashedRef = { artifact_id: fact.artifact_id, artifact_type: fact.artifact_type, content_hash: fact.content_hash.digest };
    return createDocumentEvidenceArtifactV2({
      document_ref: { artifact_id: "doc-1", artifact_type: "RAW_SOURCE", content_hash: "hash-doc-1" },
      verified_fact_refs: [factRef],
      source_metadata: { provider: "test", retrieved_at: "2026-08-24T12:00:00.000Z" },
    });
  }

  async function repoWith(fact: VerifiedDocumentFactArtifact, evidence: ReturnType<typeof buildRealV2Evidence>) {
    const repo = new InMemoryArtifactRepository();
    await repo.put({ artifact_id: fact.artifact_id, content_hash: { algorithm: "sha256", value: fact.content_hash.digest }, body: fact });
    await repo.put({ artifact_id: evidence.artifact_id, content_hash: evidence.content_hash, body: evidence });
    return repo;
  }

  it("1: untouched real V2 artifact -> PASS", async () => {
    const fact = await buildRealVerifiedFact();
    const evidence = buildRealV2Evidence(fact);
    const repo = await repoWith(fact, evidence);
    const result = await resolveEvidence({
      evidenceRefs: [
        { artifact_id: fact.artifact_id, artifact_type: fact.artifact_type },
        { artifact_id: evidence.artifact_id, artifact_type: evidence.artifact_type },
      ],
      artifactRepository: repo,
    });
    expect(result.mismatches).toEqual([]);
    expect(result.document_evidence).toHaveLength(1);
    expect(result.verified_document_facts).toHaveLength(1);
  });

  it("2: DocumentEvidence content_hash changed -> DENY", async () => {
    const fact = await buildRealVerifiedFact();
    const evidence = buildRealV2Evidence(fact);
    const tampered = { ...evidence, content_hash: { algorithm: "sha256" as const, value: "0".repeat(64) } };
    const repo = new InMemoryArtifactRepository();
    await repo.put({ artifact_id: fact.artifact_id, content_hash: { algorithm: "sha256", value: fact.content_hash.digest }, body: fact });
    await repo.put({ artifact_id: tampered.artifact_id, content_hash: tampered.content_hash, body: tampered });
    const result = await resolveEvidence({
      evidenceRefs: [{ artifact_id: tampered.artifact_id, artifact_type: tampered.artifact_type }],
      artifactRepository: repo,
    });
    expect(result.mismatches).toHaveLength(1);
    expect(result.mismatches[0].code).toBe("TAMPERED_EVIDENCE");
    expect(result.document_evidence).toHaveLength(0);
  });

  it("3: semantic payload changed (verified_fact_refs) while stored content_hash retained -> DENY", async () => {
    const fact = await buildRealVerifiedFact();
    const evidence = buildRealV2Evidence(fact);
    const tampered = {
      ...evidence,
      payload: { ...evidence.payload, verified_fact_refs: [{ artifact_id: "fact-swapped", artifact_type: "VERIFIED_DOCUMENT_FACT", content_hash: "swapped" }] },
      // content_hash left as-is -- this is the whole point of the proof
    };
    const repo = new InMemoryArtifactRepository();
    await repo.put({ artifact_id: fact.artifact_id, content_hash: { algorithm: "sha256", value: fact.content_hash.digest }, body: fact });
    await repo.put({ artifact_id: tampered.artifact_id, content_hash: tampered.content_hash, body: tampered });
    const result = await resolveEvidence({
      evidenceRefs: [{ artifact_id: tampered.artifact_id, artifact_type: tampered.artifact_type }],
      artifactRepository: repo,
    });
    expect(result.mismatches[0]?.code).toBe("TAMPERED_EVIDENCE");
    expect(result.document_evidence).toHaveLength(0);
  });

  it("4: VerifiedDocumentFact content_hash/body changed -> DENY", async () => {
    const fact = await buildRealVerifiedFact();
    const tamperedFact = { ...fact, fact_version: "9.9" }; // content_hash left as-is
    const repo = new InMemoryArtifactRepository();
    await repo.put({ artifact_id: tamperedFact.artifact_id, content_hash: { algorithm: "sha256", value: tamperedFact.content_hash.digest }, body: tamperedFact });
    const result = await resolveEvidence({
      evidenceRefs: [{ artifact_id: tamperedFact.artifact_id, artifact_type: tamperedFact.artifact_type }],
      artifactRepository: repo,
    });
    expect(result.mismatches[0]?.code).toBe("TAMPERED_EVIDENCE");
    expect(result.verified_document_facts).toHaveLength(0);
  });

  it("6: unsupported/changed contract_version on an otherwise real V2 shape is treated as V1 (structural-only), never silently promoted", async () => {
    const fact = await buildRealVerifiedFact();
    const evidence = buildRealV2Evidence(fact);
    const asOtherVersion = { ...evidence, payload: { ...evidence.payload, contract_version: "document-evidence-v3" as never } };
    const repo = new InMemoryArtifactRepository();
    await repo.put({ artifact_id: fact.artifact_id, content_hash: { algorithm: "sha256", value: fact.content_hash.digest }, body: fact });
    await repo.put({ artifact_id: asOtherVersion.artifact_id, content_hash: asOtherVersion.content_hash, body: asOtherVersion });
    const result = await resolveEvidence({
      evidenceRefs: [{ artifact_id: asOtherVersion.artifact_id, artifact_type: asOtherVersion.artifact_type }],
      artifactRepository: repo,
    });
    // isDocumentEvidenceV2 returns false for anything but exactly "document-evidence-v2" -- falls
    // through to structural-only (content_hash presence), same as real historical V1. It is NOT
    // rejected outright (V1 dispatch still admits structurally-shaped evidence), but it is also
    // NOT independently rehashed -- proving no silent promotion to V2 trust for an unknown version.
    expect(result.mismatches).toEqual([]);
    expect(result.document_evidence).toHaveLength(1);
  });

  it("7: legacy 'uncalculated' DocumentEvidenceService shape -> DENY", async () => {
    const fact = await buildRealVerifiedFact();
    const legacyShaped: DocumentEvidenceArtifact = {
      artifact_id: `doc_ev_0_random`,
      artifact_type: "DOCUMENT_EVIDENCE",
      content_hash: { algorithm: "sha256", value: "uncalculated" },
      references: [],
      payload: {
        // @ts-expect-error -- deliberately V2-shaped payload smuggled under the V1 type, matching
        // what a real legacy producer output would look like if it ever carried contract_version.
        contract_version: "document-evidence-v2",
        document_ref: { artifact_id: "doc-1", artifact_type: "DOCUMENT" },
        verified_fact_refs: [{ artifact_id: fact.artifact_id, artifact_type: fact.artifact_type, content_hash: fact.content_hash.digest }],
        source_metadata: { provider: "x", retrieved_at: "2026-01-01T00:00:00.000Z" },
      },
    };
    const repo = new InMemoryArtifactRepository();
    await repo.put({ artifact_id: fact.artifact_id, content_hash: { algorithm: "sha256", value: fact.content_hash.digest }, body: fact });
    await repo.put({ artifact_id: legacyShaped.artifact_id, content_hash: legacyShaped.content_hash, body: legacyShaped });
    const result = await resolveEvidence({
      evidenceRefs: [{ artifact_id: legacyShaped.artifact_id, artifact_type: legacyShaped.artifact_type }],
      artifactRepository: repo,
    });
    expect(result.mismatches[0]?.code).toBe("TAMPERED_EVIDENCE");
    expect(result.document_evidence).toHaveLength(0);
  });

  it("8: malformed artifact (no content_hash at all) -> DENY", async () => {
    const repo = new InMemoryArtifactRepository();
    await repo.put({ artifact_id: "malformed-1", content_hash: { algorithm: "sha256", value: "x" }, body: { artifact_type: "DOCUMENT_EVIDENCE" } });
    const result = await resolveEvidence({
      evidenceRefs: [{ artifact_id: "malformed-1", artifact_type: "DOCUMENT_EVIDENCE" }],
      artifactRepository: repo,
    });
    expect(result.mismatches[0]?.code).toBe("TAMPERED_EVIDENCE");
  });

  it("10: same valid artifact resolved twice -> deterministic same result", async () => {
    const fact = await buildRealVerifiedFact();
    const evidence = buildRealV2Evidence(fact);
    const repo = await repoWith(fact, evidence);
    const refs = [
      { artifact_id: fact.artifact_id, artifact_type: fact.artifact_type },
      { artifact_id: evidence.artifact_id, artifact_type: evidence.artifact_type },
    ];
    const r1 = await resolveEvidence({ evidenceRefs: refs, artifactRepository: repo });
    const r2 = await resolveEvidence({ evidenceRefs: refs, artifactRepository: repo });
    expect(r1.mismatches).toEqual(r2.mismatches);
    expect(r1.document_evidence.map((e) => e.artifact_id)).toEqual(r2.document_evidence.map((e) => e.artifact_id));
    expect(r1.verified_document_facts.map((f) => f.artifact_id)).toEqual(r2.verified_document_facts.map((f) => f.artifact_id));
  });
});
