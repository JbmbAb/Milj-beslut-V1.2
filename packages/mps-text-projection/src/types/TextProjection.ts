import type { SourceArtifactRef } from "./SourceArtifact.js";
import type {
  ExtractionProvenance,
  ExtractionStatus,
  ExtractorRef,
} from "./ExtractionProvenance.js";

export const TEXT_PROJECTION_CONTRACT = "text_projection" as const;
/** TEXT-L1 freeze version — bump only with deliberate contract change. */
export const TEXT_PROJECTION_VERSION = "v1.0" as const;

export interface ContentHash {
  readonly algorithm: "sha256";
  readonly value: string;
}

/**
 * TEXT-L1 frozen TextProjection.
 *
 * Invariants:
 * - Never mutates SourceArtifact / original bytes identity
 * - Carries extraction/OCR provenance + own content_hash
 * - Does NOT carry document_class (classification is a separate step)
 * - mps-chunking consumes only `text` (+ classification handoff)
 */
export interface TextProjection {
  readonly contract_id: typeof TEXT_PROJECTION_CONTRACT;
  /** Alias: projection_version (TEXT-L1). */
  readonly projection_version: typeof TEXT_PROJECTION_VERSION;
  readonly projection_id: string;
  readonly source_artifact_ref: SourceArtifactRef;
  readonly text: string;
  /** Deterministic SHA-256 over UTF-8 `text`. */
  readonly content_hash: ContentHash;
  readonly char_count: number;

  readonly extractor: ExtractorRef;
  readonly extraction_status: ExtractionStatus;
  readonly ocr_used: boolean;
  readonly ocr?: ExtractorRef;

  /** Full step trail for replay/audit (not required by chunkers). */
  readonly extraction: ExtractionProvenance;

  /**
   * Source labels needed for the *next* classification step.
   * Not a document_class — classification stays separate.
   */
  readonly doc_name: string;
  readonly source_system?: string;
  readonly mime_type?: string;
}
