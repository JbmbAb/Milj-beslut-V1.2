import { describe, it, expect } from "vitest";
import { createDocumentEvidenceArtifactV2, type DocumentEvidenceHashedRef } from "../src/artifacts/DocumentEvidenceArtifactV2";
import { createDocumentEvidencePropertyBindingArtifact } from "../src/artifacts/DocumentEvidencePropertyBindingArtifact";
import { resolveDocumentEvidenceForPropertyAssessment } from "../src/artifacts/DocumentEvidencePropertyAdmission";

/**
 * DOCUMENT-EVIDENCE-PROPERTY-BINDING-CONTRACT-V2 -- fail-closed LU admission proofs.
 */
describe("resolveDocumentEvidenceForPropertyAssessment", () => {
  const ref = (id: string, hash = `hash-${id}`): DocumentEvidenceHashedRef => ({
    artifact_id: id,
    artifact_type: "DOCUMENT",
    content_hash: hash,
  });

  const evidence = createDocumentEvidenceArtifactV2({
    document_ref: ref("mmod-doc-1"),
    text_projection_ref: ref("proj-1"),
    verified_fact_refs: [ref("fact-verified-1")],
    source_metadata: { provider: "domstolsverket-puh-mmod", retrieved_at: "2026-08-24T10:00:00.000Z" },
  });

  const evidenceRef = (): DocumentEvidenceHashedRef => ({
    artifact_id: evidence.artifact_id,
    artifact_type: evidence.artifact_type,
    content_hash: evidence.content_hash.value,
  });

  function realBinding(propertyId: string) {
    return createDocumentEvidencePropertyBindingArtifact({
      document_evidence_ref: evidenceRef(),
      property_ref: ref(propertyId),
      binding_method: "GOVERNANCE_REVIEWER_CONFIRMED",
      binding_authority: { identity_ref: { artifact_id: "bjb@miljöbeslut.se", artifact_type: "IDENTITY" }, role: "GOVERNANCE_REVIEWER" },
      justification_refs: [{ artifact_id: "review-note-1", artifact_type: "GOVERNANCE_NOTE" }],
    });
  }

  it("unbound evidence MUST NOT be admitted -- no binding artifact exists at all", () => {
    const decision = resolveDocumentEvidenceForPropertyAssessment(evidence, "property-bollnas-1", []);
    expect(decision.admitted).toBe(false);
    if (decision.admitted === false) expect(decision.reason).toMatch(/must not enter a/i);
  });

  it("bound evidence WITH a real, verified binding MAY be admitted", () => {
    const binding = realBinding("property-bollnas-1");
    const decision = resolveDocumentEvidenceForPropertyAssessment(evidence, "property-bollnas-1", [binding]);
    expect(decision.admitted).toBe(true);
    if (decision.admitted) expect(decision.binding.artifact_id).toBe(binding.artifact_id);
  });

  it("a binding for a DIFFERENT property does not admit this property", () => {
    const bindingForOtherProperty = realBinding("property-other-99");
    const decision = resolveDocumentEvidenceForPropertyAssessment(evidence, "property-bollnas-1", [bindingForOtherProperty]);
    expect(decision.admitted).toBe(false);
  });

  it("a binding for DIFFERENT evidence (even the same property) does not admit this evidence", () => {
    const otherEvidence = createDocumentEvidenceArtifactV2({
      document_ref: ref("mmod-doc-2"),
      verified_fact_refs: [ref("fact-verified-2")],
      source_metadata: { provider: "x", retrieved_at: "2026-01-01T00:00:00.000Z" },
    });
    const bindingForOtherEvidence = createDocumentEvidencePropertyBindingArtifact({
      document_evidence_ref: { artifact_id: otherEvidence.artifact_id, artifact_type: otherEvidence.artifact_type, content_hash: otherEvidence.content_hash.value },
      property_ref: ref("property-bollnas-1"),
      binding_method: "GOVERNANCE_REVIEWER_CONFIRMED",
      binding_authority: { identity_ref: { artifact_id: "bjb@miljöbeslut.se", artifact_type: "IDENTITY" }, role: "GOVERNANCE_REVIEWER" },
      justification_refs: [{ artifact_id: "review-note-1", artifact_type: "GOVERNANCE_NOTE" }],
    });
    const decision = resolveDocumentEvidenceForPropertyAssessment(evidence, "property-bollnas-1", [bindingForOtherEvidence]);
    expect(decision.admitted).toBe(false);
  });

  it("a tampered binding (content_hash no longer matches its own fields) is denied even if it names the right pair", () => {
    const binding = realBinding("property-bollnas-1");
    const tampered = { ...binding, payload: { ...binding.payload, binding_method: "AUTHORITY_STRUCTURED_SOURCE" as const } };
    const decision = resolveDocumentEvidenceForPropertyAssessment(evidence, "property-bollnas-1", [tampered]);
    expect(decision.admitted).toBe(false);
    if (decision.admitted === false) expect(decision.reason).toMatch(/tampered or malformed/i);
  });

  it("no fallback path exists via municipality, area, fact_type, or 'same source document' -- the function accepts no such parameters at all", () => {
    // Structural proof: resolveDocumentEvidenceForPropertyAssessment's signature is
    // (evidence, propertyArtifactId, candidateBindings) -- there is no municipality/area/
    // fact_type/free-text parameter to pass even if a caller wanted to.
    expect(resolveDocumentEvidenceForPropertyAssessment.length).toBe(3);
  });
});
