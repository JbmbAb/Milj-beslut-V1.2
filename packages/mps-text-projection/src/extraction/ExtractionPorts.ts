import type { ExtractionMethod } from "../types/ExtractionProvenance.js";
import type { SourceArtifact } from "../types/SourceArtifact.js";

/**
 * Ports for extraction / OCR — implementations live outside this package
 * (e.g. server adapters wrapping pdf-parse / Gemini).
 */
export interface ExtractionResult {
  readonly text: string;
  readonly method: ExtractionMethod;
  readonly version: string;
  readonly succeeded: boolean;
  readonly notes?: string;
  /** Page count reported by the provider, when it reports one (e.g. external OCR). */
  readonly page_count?: number;
  /** Provider-reported confidence, when it reports one (e.g. external OCR). */
  readonly confidence?: number;
}

export interface TextExtractorPort {
  extract(source: SourceArtifact, bytes: Uint8Array): Promise<ExtractionResult>;
}

export interface OcrPort {
  ocr(source: SourceArtifact, bytes: Uint8Array): Promise<ExtractionResult>;
}
