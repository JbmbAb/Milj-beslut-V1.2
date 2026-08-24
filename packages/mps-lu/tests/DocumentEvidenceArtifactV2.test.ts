import { describe, it, expect } from "vitest";
import {
  computeDocumentEvidenceV2Identity,
  createDocumentEvidenceArtifactV2,
  isDocumentEvidenceV2,
  isDocumentEvidenceV2ContentHashValid,
  type DocumentEvidenceHashedRef,
  type DocumentEvidenceV2Input,
} from "../src/artifacts/DocumentEvidenceArtifactV2";
import type { DocumentEvidenceArtifact } from "../src/artifacts/DocumentEvidenceArtifact";

/**
 * DOCUMENT-EVIDENCE-PROPERTY-BINDING-CONTRACT-V2 -- identity/determinism/tamper proofs.
 */
describe("DocumentEvidenceArtifactV2", () => {
  const ref = (id: string, hash = `hash-${id}`): DocumentEvidenceHashedRef => ({
    artifact_id: id,
    artifact_type: "DOCUMENT",
    content_hash: hash,
  });

  function baseInput(overrides: Partial<DocumentEvidenceV2Input> = {}): DocumentEvidenceV2Input {
    return {
      document_ref: ref("mmod-doc-1"),
      text_projection_ref: ref("proj-1"),
      verified_fact_refs: [ref("fact-verified-1")],
      source_metadata: { provider: "domstolsverket-puh-mmod", retrieved_at: "2026-08-24T10:00:00.000Z" },
      ...overrides,
    };
  }

  it("has no property_ref field anywhere on the payload -- the whole point of V2", () => {
    const evidence = createDocumentEvidenceArtifactV2(baseInput());
    expect(Object.keys(evidence.payload)).not.toContain("property_ref");
  });

  it("RED-1: same verified fact + same frozen semantic inputs -> same identity, independent of retrieved_at (IMPORT-TIME-001)", () => {
    const a = createDocumentEvidenceArtifactV2(baseInput({ source_metadata: { provider: "x", retrieved_at: "2026-01-01T00:00:00.000Z" } }));
    const b = createDocumentEvidenceArtifactV2(baseInput({ source_metadata: { provider: "x", retrieved_at: "2030-01-01T00:00:00.000Z" } }));
    expect(a.artifact_id).toBe(b.artifact_id);
    expect(a.artifact_id).toBe(computeDocumentEvidenceV2Identity(baseInput({ source_metadata: { provider: "x", retrieved_at: "irrelevant" } })));
  });

  it("RED-2: changing the verified fact ref changes identity", () => {
    const a = createDocumentEvidenceArtifactV2(baseInput());
    const b = createDocumentEvidenceArtifactV2(baseInput({ verified_fact_refs: [ref("fact-verified-2")] }));
    expect(a.artifact_id).not.toBe(b.artifact_id);
  });

  it("RED-4 / self-consistency: content_hash is independently recomputable from the artifact's own carried fields", () => {
    const evidence = createDocumentEvidenceArtifactV2(baseInput());
    expect(isDocumentEvidenceV2ContentHashValid(evidence)).toBe(true);
  });

  it("RED-4: a V2 artifact body altered after creation fails independent rehash", () => {
    const evidence = createDocumentEvidenceArtifactV2(baseInput());
    const tampered = { ...evidence, payload: { ...evidence.payload, verified_fact_refs: [ref("fact-verified-999")] } };
    expect(isDocumentEvidenceV2ContentHashValid(tampered)).toBe(false);
  });

  it("RED-6: the legacy fake-hash shape (content_hash.value === 'uncalculated') fails the same rehash check -- structurally excluded, not special-cased", () => {
    const evidence = createDocumentEvidenceArtifactV2(baseInput());
    const legacyShaped = { ...evidence, content_hash: { algorithm: "sha256" as const, value: "uncalculated" } };
    expect(isDocumentEvidenceV2ContentHashValid(legacyShaped)).toBe(false);
  });

  it("requires at least one verified_fact_ref -- V2 evidence cannot exist unbound from Tier 3 verification", () => {
    expect(() => createDocumentEvidenceArtifactV2(baseInput({ verified_fact_refs: [] }))).toThrow(/at least one verified_fact_ref/i);
  });

  it("RED-8: V1 and V2 share artifact_type but are distinguished explicitly by contract_version, never silently reinterpreted", () => {
    const v2 = createDocumentEvidenceArtifactV2(baseInput());
    expect(isDocumentEvidenceV2(v2)).toBe(true);

    const v1shaped: DocumentEvidenceArtifact = {
      artifact_id: "doc_ev_1",
      artifact_type: "DOCUMENT_EVIDENCE",
      content_hash: { algorithm: "sha256", value: "hash-v1" },
      references: [],
      payload: {
        property_ref: { artifact_id: "prop-1", artifact_type: "PROPERTY" },
        document_ref: { artifact_id: "doc-1", artifact_type: "DOCUMENT" },
        source_metadata: { provider: "x", retrieved_at: "2026-01-01T00:00:00.000Z" },
      },
    };
    expect(isDocumentEvidenceV2(v1shaped)).toBe(false);
  });
});
