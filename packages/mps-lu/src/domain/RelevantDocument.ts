import type { ArtifactReference } from "@miljobeslut/mps-compliance/src/artifacts/ArtifactContract";

/**
 * OWNER FREEZE 2026-08-12 — RelevantDocument Contract.
 *
 * `RelevantDocument` is a **structured description of a document as a document**. It is not
 * raw text, not a text projection, and not a legal fact.
 *
 *   RelevantDocument   describes the document
 *   TextProjection     owns the document's text        (TEXT-L1, packages/mps-text-projection)
 *   DocumentFact       describes what the document MEANS (Tier 3, mps-data-governance)
 *
 * The boundary matters: a legal or semantic claim encoded here would be a fact without
 * provenance, verification, or a source span — exactly what the Document Fact Model exists to
 * prevent.
 *
 * This file is the SINGLE canonical type owner. `lu-domain.ts` re-exports it; it must never
 * declare a second copy, because two parallel declarations of one semantic contract can drift
 * apart silently.
 *
 * @see docs/architecture/F4B-DOCUMENT-FACT-MODEL-CHECK-2026-08-12.md
 * @see packages/mps-data-governance/src/DocumentFactArtifact.ts
 */

/**
 * Closed, non-semantic descriptive attributes. Deliberately NOT `Record<string, any>`:
 * an open bag is how legal conclusions get smuggled in as data.
 *
 * Permitted: attributes that describe the document.
 * Forbidden: claims about what the document means or effects — e.g. `restrictive: true`,
 * `location_relevant: true`, `decision_outcome: "rejected"`, `legal_effect`, `risk`.
 * Those are `DocumentFact`s and require assertion, verification and a source span.
 */
export interface RelevantDocumentMetadata {
  readonly authority?: string;
  readonly court?: string;
  readonly case_number?: string;
  /** ISO8601 date of the document itself, not of its retrieval. */
  readonly document_date?: string;
  readonly source_url?: string;
  readonly language?: string;
}

export interface RelevantDocument {
  readonly title: string;
  readonly type: "decision" | "injunction" | "notification" | "inspection";
  readonly metadata: RelevantDocumentMetadata;
  /**
   * P3-LU-DOCUMENT-CLASSIFICATION-01 — the admitted DocumentClassificationArtifact this type
   * came from. REQUIRED.
   *
   * Without it a `type` is a value someone set, indistinguishable downstream from one that was
   * decided by a governed classifier over governed material. It is not optional: an optional
   * provenance binding is one that is never actually required, and the invariant would erode to
   * a convention.
   *
   * The vocabulary above stays closed. A document that could not be classified yields no
   * RelevantDocument at all — UNCLASSIFIED lives on the classification artifact.
   */
  readonly classification_ref: ArtifactReference;
}

/**
 * Maps a producer's document-type label onto the closed vocabulary.
 *
 * Returns `undefined` for unknown labels rather than guessing: silently defaulting an
 * unrecognised label to `"decision"` would let a producer's free string become a typed claim.
 */
export function toRelevantDocumentType(
  label: string,
): RelevantDocument["type"] | undefined {
  switch (label.trim().toUpperCase()) {
    case "BESLUT":
    case "DECISION":
      return "decision";
    case "FORELAGGANDE":
    case "FÖRELÄGGANDE":
    case "INJUNCTION":
      return "injunction";
    case "UNDERRATTELSE":
    case "UNDERRÄTTELSE":
    case "NOTIFICATION":
      return "notification";
    case "INSPEKTION":
    case "INSPECTION":
      return "inspection";
    default:
      return undefined;
  }
}
