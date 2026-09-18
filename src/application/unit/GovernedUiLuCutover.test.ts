import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { InMemoryArtifactRepository } from "../../../packages/mps-runtime/src/repository/InMemoryArtifactRepository";
import { createDocumentEvidenceArtifactV2 } from "../../../packages/mps-lu/src/artifacts/DocumentEvidenceArtifactV2";
import { createDocumentEvidencePropertyBindingArtifactV3 } from "../../../packages/mps-lu/src/artifacts/DocumentEvidencePropertyBindingArtifactV3";
import type { DocumentEvidenceArtifact } from "../../../packages/mps-lu/src/artifacts/DocumentEvidenceArtifact";
import {
  GOVERNED_DOCUMENT_EVIDENCE_SOURCE,
  NO_GOVERNED_DOCUMENT_EVIDENCE_DETAIL,
  V1_NOT_ELIGIBLE_AS_NEW_LU_INPUT,
  resolveGovernedDocumentEvidenceForLuAssessment,
} from "../resolveGovernedDocumentEvidenceForLuAssessment";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const H = (ch: string): string => ch.repeat(64);

function v1Evidence(propertyId: string): DocumentEvidenceArtifact {
  return {
    artifact_id: "doc_ev_v1_cutover",
    artifact_type: "DOCUMENT_EVIDENCE",
    content_hash: { algorithm: "sha256", value: "hash-v1-cutover" },
    references: [{ artifact_id: propertyId, artifact_type: "LU_PROPERTY_CONTEXT" }],
    payload: {
      property_ref: { artifact_id: propertyId, artifact_type: "LU_PROPERTY_CONTEXT" },
      document_ref: { artifact_id: "legacy-doc", artifact_type: "EXTERNAL_DOCUMENT" },
      source_metadata: { provider: "legacy", retrieved_at: "2026-08-01T00:00:00.000Z" },
    },
  };
}

function governedChain(propertyId: string) {
  const factRef = {
    artifact_id: "fact-verified-cutover",
    artifact_type: "VERIFIED_DOCUMENT_FACT" as const,
    content_hash: H("9"),
  };
  const evidence = createDocumentEvidenceArtifactV2({
    document_ref: { artifact_id: "raw-doc-cutover", artifact_type: "RAW_SOURCE", content_hash: H("a") },
    verified_fact_refs: [factRef],
    source_metadata: { provider: "cutover-test", retrieved_at: "2026-08-28T00:00:00.000Z" },
  });
  const binding = createDocumentEvidencePropertyBindingArtifactV3({
    contract_version: "document-evidence-property-binding-v3",
    document_evidence_ref: {
      artifact_id: evidence.artifact_id,
      artifact_type: evidence.artifact_type,
      content_hash: evidence.content_hash.value,
    },
    verified_fact_refs: [factRef],
    property_ref: {
      artifact_id: propertyId,
      artifact_type: "LU_PROPERTY_CONTEXT",
      content_hash: H("b"),
    },
    binding_authority: {
      identity_ref: { id: "reviewer-cutover", content_hash: { algorithm: "sha256", digest: H("c") } },
      role: "GOVERNANCE_REVIEWER",
    },
    justification_refs: [{ artifact_id: "justification-1", artifact_type: "GOVERNANCE_NOTE" }],
    review_attestation_ref: {
      artifact_id: "attestation-1",
      artifact_type: "DOCUMENT_PROPERTY_REVIEW_ATTESTATION",
      content_hash: H("d"),
    },
  });
  return { evidence, binding };
}

async function put(
  repo: InMemoryArtifactRepository,
  artifact: { artifact_id: string; content_hash: { algorithm: "sha256"; value: string } },
): Promise<void> {
  await repo.put({
    artifact_id: artifact.artifact_id,
    content_hash: artifact.content_hash,
    body: artifact,
  });
}

describe("GOVERNED-UI-LU-CUTOVER-01", () => {
  const propertyId = "property-context-cutover";

  it("usecase source never mints V1 document evidence or swallows generation errors", () => {
    const src = readFileSync(path.resolve(__dirname, "../generate-localization-report.usecase.ts"), "utf8");
    expect(src).toContain("resolveGovernedDocumentEvidenceForLuAssessment");
    expect(src).not.toContain("generateDocumentEvidence");
    expect(src).not.toContain("uncalculated");
    expect(src).not.toContain("Math.random");
    expect(src).not.toMatch(/Failed to generate document evidence/);
  });

  it("absence of governed V2/V3 evidence is an explicit coverage state, not fabricated V1", async () => {
    const repo = new InMemoryArtifactRepository();
    const result = await resolveGovernedDocumentEvidenceForLuAssessment({
      propertyContextArtifactId: propertyId,
      repository: repo,
    });
    expect(result.evidence).toEqual([]);
    expect(result.coverage).toEqual({
      source: GOVERNED_DOCUMENT_EVIDENCE_SOURCE,
      status: "unavailable",
      detail: NO_GOVERNED_DOCUMENT_EVIDENCE_DETAIL,
    });
    expect(result.warnings.some((w) => /V1-dokumentbevis genereras inte/i.test(w))).toBe(true);
  });

  it("resolves property-scoped DocumentEvidence V2 via PropertyBinding V3 without client refs", async () => {
    const repo = new InMemoryArtifactRepository();
    const { evidence, binding } = governedChain(propertyId);
    await put(repo, evidence);
    await put(repo, binding);

    const result = await resolveGovernedDocumentEvidenceForLuAssessment({
      propertyContextArtifactId: propertyId,
      repository: repo,
    });

    expect(result.evidence.map((item) => item.artifact_id)).toEqual([evidence.artifact_id]);
    expect(result.coverage.status).toBe("ok");
    expect(result.coverage.source).toBe(GOVERNED_DOCUMENT_EVIDENCE_SOURCE);
  });

  it("does not treat V1 document evidence as new governed LU input", async () => {
    const repo = new InMemoryArtifactRepository();
    const v1 = v1Evidence(propertyId);
    await repo.put({
      artifact_id: v1.artifact_id,
      content_hash: v1.content_hash,
      body: v1,
    });

    const result = await resolveGovernedDocumentEvidenceForLuAssessment({
      propertyContextArtifactId: propertyId,
      documentEvidenceRefs: [{ artifact_id: v1.artifact_id, artifact_type: "DOCUMENT_EVIDENCE" }],
      repository: repo,
    });

    expect(result.evidence).toEqual([]);
    expect(result.coverage.status).toBe("unavailable");
    expect(result.warnings).toContain(V1_NOT_ELIGIBLE_AS_NEW_LU_INPUT);
  });

  it("fails closed when a property-matching V3 binding is tampered", async () => {
    const repo = new InMemoryArtifactRepository();
    const { evidence, binding } = governedChain(propertyId);
    await put(repo, evidence);
    const tampered = {
      ...binding,
      payload: {
        ...binding.payload,
        justification_refs: [{ artifact_id: "tampered", artifact_type: "GOVERNANCE_NOTE" }],
      },
    };
    await repo.put({
      artifact_id: tampered.artifact_id,
      content_hash: binding.content_hash,
      body: tampered,
    });

    await expect(
      resolveGovernedDocumentEvidenceForLuAssessment({
        propertyContextArtifactId: propertyId,
        repository: repo,
      }),
    ).rejects.toThrow(/content_hash is invalid/);
  });

  it("ignores V3 bindings for a different property instead of mixing them in", async () => {
    const repo = new InMemoryArtifactRepository();
    const { evidence, binding } = governedChain("other-property-context");
    await put(repo, evidence);
    await put(repo, binding);

    const result = await resolveGovernedDocumentEvidenceForLuAssessment({
      propertyContextArtifactId: propertyId,
      repository: repo,
    });
    expect(result.evidence).toEqual([]);
    expect(result.coverage.status).toBe("unavailable");
  });
});
