import type { DocumentEvidenceArtifactV2 } from "./DocumentEvidenceArtifactV2";
import {
  isDocumentEvidencePropertyBindingContentHashValid,
  type DocumentEvidencePropertyBindingArtifact,
} from "./DocumentEvidencePropertyBindingArtifact";

/**
 * DOCUMENT-EVIDENCE-PROPERTY-BINDING-CONTRACT-V2 -- the fail-closed rule.
 *
 * Unbound V2 DocumentEvidence MAY exist canonically. It MUST NOT enter a property-specific LU
 * assessment. This function is the executable form of that rule: it is not wired into any real
 * LU pipeline in this unit (that is Unit G, not yet started) -- it exists so the invariant is
 * proven, not merely stated in a comment.
 *
 * The ONLY thing that can admit evidence for a specific property is an actual, content-hash-
 * verified `DocumentEvidencePropertyBindingArtifact` naming BOTH the exact evidence and the
 * exact property. No other signal is consulted, on purpose: this function never looks at
 * `evidence.payload` for a municipality name, an area, free text, `fact_type`, or "same source
 * document as some other bound evidence" -- none of those are cadastral identity, and inferring
 * from them would silently reintroduce exactly the conflation V2 was built to remove.
 */
export type DocumentEvidencePropertyAdmissionDecision =
  | { readonly admitted: true; readonly binding: DocumentEvidencePropertyBindingArtifact }
  | { readonly admitted: false; readonly reason: string };

export function resolveDocumentEvidenceForPropertyAssessment(
  evidence: DocumentEvidenceArtifactV2,
  propertyArtifactId: string,
  /** Only real, already-constructed binding artifacts under consideration -- never a lookup, a
   *  guess, or free text. Typically a governance-provided candidate list, not "all bindings". */
  candidateBindings: readonly DocumentEvidencePropertyBindingArtifact[],
): DocumentEvidencePropertyAdmissionDecision {
  const matches = candidateBindings.filter(
    (b) =>
      b.payload.document_evidence_ref.artifact_id === evidence.artifact_id &&
      b.payload.document_evidence_ref.content_hash === evidence.content_hash.value &&
      b.payload.property_ref.artifact_id === propertyArtifactId,
  );

  if (matches.length === 0) {
    return {
      admitted: false,
      reason:
        `No DocumentEvidencePropertyBindingArtifact binds evidence '${evidence.artifact_id}' to ` +
        `property '${propertyArtifactId}'. Unbound document evidence must not enter a ` +
        `property-specific LU assessment.`,
    };
  }

  const binding = matches[0];
  if (!isDocumentEvidencePropertyBindingContentHashValid(binding)) {
    return {
      admitted: false,
      reason: `Binding '${binding.artifact_id}' content_hash does not match its own carried fields -- tampered or malformed binding, refusing to admit.`,
    };
  }

  return { admitted: true, binding };
}
