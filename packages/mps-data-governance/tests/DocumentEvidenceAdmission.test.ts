import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { FileCASRepository, LocalPemSigningKeyProvider, createArtifactAttestation } from "@miljobeslut/mimers-brunn-core";
import {
  DocumentEvidenceAdmissionError,
  DocumentEvidenceAdmitter,
  DOCUMENT_EVIDENCE_ADMISSION_ACTION,
  DOCUMENT_EVIDENCE_ADMISSION_PREDICATE_TYPE,
  DOCUMENT_EVIDENCE_ADMISSION_SCHEMA_VERSION,
  type AdmittableDocumentEvidenceV2,
  type DocumentEvidenceAdmissionPredicate,
} from "../src/DocumentEvidenceAdmission";

/**
 * DOCUMENT-EVIDENCE-CANONICAL-ADMISSION-V1 -- offline proofs against a real temp-directory CAS
 * (not the real ~/.mimers state; the real chain is proven separately by
 * scripts/ops/prove-document-evidence-canonical-admission-01.ts).
 */
describe("DocumentEvidenceAdmitter", () => {
  let tmpDir: string;
  let cas: FileCASRepository;
  const gov = LocalPemSigningKeyProvider.generate("ed25519:test-governance");
  const APPROVER_ACTOR_ID = "test-approver@example.com";
  const APPROVER_ROLE = "ADMIN";
  const GOVERNANCE_RELEASE = "v1";

  beforeAll(async () => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "doc-evidence-admission-test-"));
    cas = new FileCASRepository(tmpDir, { durabilityMode: "none" });
    await cas.initialize();
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function realEvidence(overrides: Partial<AdmittableDocumentEvidenceV2["payload"]> = {}): AdmittableDocumentEvidenceV2 {
    const payload = {
      contract_version: "document-evidence-v2",
      document_ref: { artifact_id: "doc-1", artifact_type: "RAW_SOURCE", content_hash: "hash-doc-1" },
      verified_fact_refs: [{ artifact_id: "fact-verified-1", artifact_type: "VERIFIED_DOCUMENT_FACT", content_hash: "hash-fact-1" }],
      source_metadata: { provider: "test", retrieved_at: "2026-08-24T10:00:00.000Z" },
      ...overrides,
    };
    return {
      artifact_id: "doc-evidence-v2-test-1",
      artifact_type: "DOCUMENT_EVIDENCE",
      content_hash: { algorithm: "sha256", value: "real-content-hash-1" },
      payload,
    };
  }

  const recomputeAlwaysMatches = (a: AdmittableDocumentEvidenceV2) => a.content_hash.value;
  const recomputeAlwaysMismatches = () => "definitely-not-the-real-hash";

  async function attestationFor(
    target: AdmittableDocumentEvidenceV2,
    overrides: Partial<DocumentEvidenceAdmissionPredicate> = {},
    signer = gov.provider,
  ) {
    const predicate: DocumentEvidenceAdmissionPredicate = {
      action: DOCUMENT_EVIDENCE_ADMISSION_ACTION,
      evidence_artifact_id: target.artifact_id,
      evidence_content_hash: target.content_hash.value,
      approver_actor_id: APPROVER_ACTOR_ID,
      approver_role: APPROVER_ROLE,
      governance_release: GOVERNANCE_RELEASE,
      attestation_schema_version: DOCUMENT_EVIDENCE_ADMISSION_SCHEMA_VERSION,
      signer_key_id: signer.keyId,
      ...overrides,
    };
    return createArtifactAttestation({
      subjectDigest: `sha256:${target.content_hash.value}`,
      predicateType: DOCUMENT_EVIDENCE_ADMISSION_PREDICATE_TYPE,
      predicate: predicate as unknown as Record<string, unknown>,
      signing: signer,
    });
  }

  it("1: real V2 evidence + valid governance admission -> CAS write succeeds", async () => {
    const admitter = new DocumentEvidenceAdmitter(cas, gov.provider);
    const evidence = realEvidence({ document_ref: { artifact_id: "doc-unique-1", artifact_type: "RAW_SOURCE", content_hash: "h1" } });
    const attestation = await attestationFor(evidence);
    const result = await admitter.admit(evidence, attestation, GOVERNANCE_RELEASE, recomputeAlwaysMatches);
    expect(result.cas_content_hash).toMatch(/^sha256:/);
    expect(result.is_duplicate).toBe(false);
  });

  it("2: same exact evidence admitted twice -> idempotent, same CAS identity", async () => {
    const admitter = new DocumentEvidenceAdmitter(cas, gov.provider);
    const evidence = realEvidence({ document_ref: { artifact_id: "doc-unique-2", artifact_type: "RAW_SOURCE", content_hash: "h2" } });
    const a1 = await admitter.admit(evidence, await attestationFor(evidence), GOVERNANCE_RELEASE, recomputeAlwaysMatches);
    const a2 = await admitter.admit(evidence, await attestationFor(evidence), GOVERNANCE_RELEASE, recomputeAlwaysMatches);
    expect(a2.cas_content_hash).toBe(a1.cas_content_hash);
    expect(a2.is_duplicate).toBe(true);
  });

  it("4: tampered content_hash (independent recompute mismatch) -> DENY", async () => {
    const admitter = new DocumentEvidenceAdmitter(cas, gov.provider);
    const evidence = realEvidence();
    const attestation = await attestationFor(evidence);
    await expect(admitter.admit(evidence, attestation, GOVERNANCE_RELEASE, recomputeAlwaysMismatches)).rejects.toThrow(
      /does not match the evidence's own content_hash/i,
    );
  });

  it("6: wrong signer/key -> DENY", async () => {
    const admitter = new DocumentEvidenceAdmitter(cas, gov.provider);
    const impostor = LocalPemSigningKeyProvider.generate("ed25519:impostor");
    const evidence = realEvidence();
    const attestation = await attestationFor(evidence, { signer_key_id: impostor.provider.keyId }, impostor.provider);
    await expect(admitter.admit(evidence, attestation, GOVERNANCE_RELEASE, recomputeAlwaysMatches)).rejects.toThrow(
      DocumentEvidenceAdmissionError,
    );
  });

  it("7: wrong action/predicate -> DENY", async () => {
    const admitter = new DocumentEvidenceAdmitter(cas, gov.provider);
    const evidence = realEvidence();
    const attestation = await attestationFor(evidence, { action: "document_evidence.delete" as never });
    await expect(admitter.admit(evidence, attestation, GOVERNANCE_RELEASE, recomputeAlwaysMatches)).rejects.toThrow(
      /action is not/i,
    );
  });

  it("8: legacy 'uncalculated' shape -> DENY (fails the same content_hash recompute check, not special-cased)", async () => {
    const admitter = new DocumentEvidenceAdmitter(cas, gov.provider);
    const legacyShaped: AdmittableDocumentEvidenceV2 = {
      artifact_id: `doc_ev_0_random`,
      artifact_type: "DOCUMENT_EVIDENCE",
      content_hash: { algorithm: "sha256", value: "uncalculated" },
      payload: {
        contract_version: "document-evidence-v2",
        verified_fact_refs: [{ artifact_id: "fact-1", artifact_type: "VERIFIED_DOCUMENT_FACT", content_hash: "h" }],
      },
    };
    const attestation = await attestationFor(legacyShaped);
    // A real recompute function would never produce "uncalculated" -- simulate that honestly.
    await expect(
      admitter.admit(legacyShaped, attestation, GOVERNANCE_RELEASE, () => "a-real-computed-hash-1234"),
    ).rejects.toThrow(/does not match the evidence's own content_hash/i);
  });

  it("9: V2 with a fabricated property_ref -> rejected structurally", async () => {
    const admitter = new DocumentEvidenceAdmitter(cas, gov.provider);
    const evidence = realEvidence({ property_ref: { artifact_id: "guessed", artifact_type: "PROPERTY" } } as never);
    const attestation = await attestationFor(evidence);
    await expect(admitter.admit(evidence, attestation, GOVERNANCE_RELEASE, recomputeAlwaysMatches)).rejects.toThrow(
      /must not carry property_ref/i,
    );
  });

  it("10: V2 with no property binding -> canonical CAS admission MAY still succeed", async () => {
    const admitter = new DocumentEvidenceAdmitter(cas, gov.provider);
    const evidence = realEvidence({ document_ref: { artifact_id: "doc-unbound-1", artifact_type: "RAW_SOURCE", content_hash: "h-unbound" } });
    expect("property_ref" in evidence.payload).toBe(false);
    const result = await admitter.admit(evidence, await attestationFor(evidence), GOVERNANCE_RELEASE, recomputeAlwaysMatches);
    expect(result.cas_content_hash).toMatch(/^sha256:/);
  });

  it("V1-shaped contract_version is rejected by this gate -- historical V1 admission is untouched, never reinterpreted", async () => {
    const admitter = new DocumentEvidenceAdmitter(cas, gov.provider);
    const v1shaped = realEvidence();
    const asV1 = { ...v1shaped, payload: { ...v1shaped.payload, contract_version: "document-evidence-v1" } };
    const attestation = await attestationFor(asV1);
    await expect(admitter.admit(asV1, attestation, GOVERNANCE_RELEASE, recomputeAlwaysMatches)).rejects.toThrow(
      /Unsupported contract_version/i,
    );
  });

  it("requires at least one verified_fact_ref", async () => {
    const admitter = new DocumentEvidenceAdmitter(cas, gov.provider);
    const evidence = realEvidence({ verified_fact_refs: [] });
    const attestation = await attestationFor(evidence);
    await expect(admitter.admit(evidence, attestation, GOVERNANCE_RELEASE, recomputeAlwaysMatches)).rejects.toThrow(
      /at least one verified_fact_ref/i,
    );
  });
});
