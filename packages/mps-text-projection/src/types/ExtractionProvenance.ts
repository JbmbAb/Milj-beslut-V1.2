/**
 * How text was produced from a SourceArtifact.
 * Versions must be explicit so PDF→text→chunks is reproducible.
 */

/** Wire/method identifiers used in extraction steps. */
export type ExtractionMethod =
  | "pdf_parse"
  | "plain_text"
  | "html"
  | "json"
  | "ocr_gemini"
  | "ocr_external"
  | "preextracted"
  | "none";

/**
 * TEXT-L1 freeze surface for extractor.kind
 * (detail remains in ExtractionStep.method).
 */
export type ExtractorKind = "pdf-parse" | "ocr" | "preextracted" | "plain-text" | "html" | "json" | "none";

/** TEXT-L1 freeze: complete | partial | failed */
export type ExtractionStatus = "complete" | "partial" | "failed";

/** @deprecated use ExtractionStatus — mapped from internal completeness */
export type ExtractionCompleteness = "full" | "partial" | "empty" | "failed";

export interface ExtractionStep {
  readonly method: ExtractionMethod;
  /** Tool/model version string (e.g. pdf-parse@x, gemini-2.5-flash). */
  readonly version: string;
  readonly char_count: number;
  readonly succeeded: boolean;
  readonly notes?: string;
}

export interface ExtractorRef {
  readonly kind: ExtractorKind;
  readonly version: string;
}

export interface ExtractionProvenance {
  readonly steps: readonly ExtractionStep[];
  /** TEXT-L1: primary extractor used for the projection text. */
  readonly extractor: ExtractorRef;
  readonly ocr_used: boolean;
  readonly ocr?: ExtractorRef;
  readonly extraction_status: ExtractionStatus;
  /** Threshold used to decide OCR fallback / partial. */
  readonly min_chars_threshold: number;
}

export function methodToExtractorKind(method: ExtractionMethod): ExtractorKind {
  switch (method) {
    case "pdf_parse":
      return "pdf-parse";
    case "ocr_gemini":
    case "ocr_external":
      return "ocr";
    case "preextracted":
      return "preextracted";
    case "plain_text":
      return "plain-text";
    case "html":
      return "html";
    case "json":
      return "json";
    case "none":
      return "none";
    default: {
      const _exhaustive: never = method;
      return _exhaustive;
    }
  }
}

export function toExtractionStatus(
  completeness: ExtractionCompleteness,
): ExtractionStatus {
  switch (completeness) {
    case "full":
      return "complete";
    case "partial":
      return "partial";
    case "empty":
    case "failed":
      return "failed";
    default: {
      const _exhaustive: never = completeness;
      return _exhaustive;
    }
  }
}
