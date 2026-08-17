import type { ArtifactReference } from "@miljobeslut/mps-compliance/src/artifacts/ArtifactContract";
import type { DocumentClassification } from "../artifacts/DocumentClassificationArtifact";

/**
 * 🜃 P3-LU-DOCUMENT-CLASSIFICATION-01B — the PURE half of the classification runtime.
 *
 * `classifyDocument()` proposes. It does not decide.
 *
 * This module deliberately exports nothing that can persist, verify, or admit a classification.
 * Those live in `./ClassificationAuthority.ts`. A component that interprets AND persists AND
 * verifies AND approves its own output has no authority boundary — only a call stack.
 *
 * ⚠️ THIS MODULE CONTAINS NO CLASSIFICATION POLICY. It holds no rule for deciding between
 * decision / injunction / notification / inspection, and it must never acquire one by inspecting
 * a file name, a title, or a publication-form value. Gate A established that the producer does
 * not expose a document class per publication; a heuristic placed here would be the correct
 * architecture filled with the same epistemic error it exists to prevent.
 *
 * What decides is the INJECTED classifier contract. Which classifier contracts are permitted to
 * return anything other than UNCLASSIFIED is a separate governed question, and a separate unit.
 *
 * @see ./ClassificationAuthority.ts
 * @see ../artifacts/DocumentClassificationArtifact.ts
 */

/** The minimum an evidence artifact must expose to be classifiable. */
export interface ClassifiableEvidence {
  readonly artifact_id: string;
  readonly artifact_type: string;
  readonly content_hash: { readonly algorithm: "sha256"; readonly value: string };
  readonly payload: unknown;
}

/**
 * A classifier, injected.
 *
 * `classify` must be a pure function of the evidence it is handed: replay depends on identical
 * inputs reproducing an identical result, and a classifier that consults the clock, the network,
 * or mutable state cannot satisfy that.
 */
export interface ClassifierContract {
  readonly classifier_id: string;
  readonly classifier_version: string;
  classify(evidence: ClassifiableEvidence): {
    readonly classification: string;
    readonly classification_basis: readonly ArtifactReference[];
  };
}

/**
 * A proposal — not an artifact, and not an authority.
 *
 * `classification` is typed as `string`, not `DocumentClassification`, on purpose. A classifier
 * is an external contract and may return anything; narrowing here would make the type system
 * assert an admission that nothing has actually checked. The narrowing happens once, in
 * `issueClassification()`, where it fails closed.
 */
export interface ClassificationResult {
  readonly source_document_evidence_ref: ArtifactReference;
  readonly classification: string;
  readonly classifier_id: string;
  readonly classifier_version: string;
  readonly classification_basis: readonly ArtifactReference[];
}

export interface ClassifyDocumentInput {
  readonly evidence: ClassifiableEvidence;
  readonly classifier: ClassifierContract;
}

/**
 * Runs the injected classifier over one evidence artifact.
 *
 * Pure and synchronous: no I/O, no persistence, no store parameter. The result names the exact
 * observation it was produced from, so the authority layer can bind it without re-deriving the
 * reference from something looser, like a document id.
 */
export function classifyDocument(input: ClassifyDocumentInput): ClassificationResult {
  const { evidence, classifier } = input;

  const proposed = classifier.classify(evidence);

  return {
    source_document_evidence_ref: {
      artifact_id: evidence.artifact_id,
      artifact_type: evidence.artifact_type,
    },
    classification: proposed.classification,
    classifier_id: classifier.classifier_id,
    classifier_version: classifier.classifier_version,
    classification_basis: [...proposed.classification_basis],
  };
}

/** Re-exported for callers that narrow a result AFTER the authority layer has admitted it. */
export type { DocumentClassification };
