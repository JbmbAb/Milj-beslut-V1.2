import type { RelevantDocumentMetadata } from "./RelevantDocument";

/**
 * 🜃 P3-LU-DOCUMENT-CLASSIFICATION-01C — POSTGIS_DOCUMENT_PROVIDER_AUTHORITY_V1.
 *
 * What a document provider is allowed to produce.
 *
 * A provider OBSERVES documents. It does not decide what they are. `DocumentProviderContract`
 * previously obliged every provider to return `RelevantDocument[]` — a typed legal claim — which
 * meant any conforming provider had to classify. `PostgisDocumentProvider` duly did, by substring
 * match over a free database string, with a default that turned a MISSING value into `decision`
 * and a fallthrough that turned an UNKNOWN one into `notification`.
 *
 * The contract encoded the wrong authority model, so the contract changed.
 *
 *   PostGIS DocumentRecord → DocumentDescriptor → DocumentEvidenceArtifact
 *     → DocumentClassificationArtifact → verified projection → RelevantDocument
 *
 * @see ./RelevantDocument.ts
 * @see ../classification/ClassificationAuthority.ts
 */
export interface DocumentDescriptor {
  /** Identifies the document at the source. Not an artifact id. */
  readonly document_ref: string;

  /** Descriptive only, exactly as `RelevantDocument` requires — no legal characterisation. */
  readonly title: string;
  readonly metadata: RelevantDocumentMetadata & Readonly<Record<string, unknown>>;

  /**
   * The classification string the SOURCE supplied, verbatim. NON-AUTHORITATIVE.
   *
   * Preserved rather than discarded: it is real observation, and a future governed classifier
   * may need it as `classification_basis`. Absent when the source supplied none — which is
   * itself information, and must not be filled in with a default.
   *
   * It must never reach `RelevantDocument.type` without passing through the classification
   * authority. `"court_decision"` is not `decision`; `toRelevantDocumentType()` rejects it, and
   * that rejection is correct.
   */
  readonly source_classification_label?: string;
}
