import {
  DEFAULT_MIN_CHARS_THRESHOLD,
  TextIngestionPipeline,
  type TextIngestionDeps,
  type TextIngestionResult,
  type SourceArtifact,
} from '@miljobeslut/mps-text-projection';
import { createPdfParseExtractorAdapter } from './pdfParseExtractorAdapter';
import { createGeminiOcrAdapter } from './geminiOcrAdapter';

export interface GovernedTextIngestionOptions {
  readonly enable_ocr_fallback?: boolean;
  readonly min_chars_threshold?: number;
  /** Inject test doubles; defaults to pdf-parse + Gemini OCR adapters. */
  readonly deps?: TextIngestionDeps;
}

/**
 * Single production entry: SourceArtifact + bytes → TextProjection (+ classify / chunk).
 * Adapters MUST NOT emit alternate projection formats.
 */
export function createGovernedTextIngestion(
  options: GovernedTextIngestionOptions = {},
): TextIngestionPipeline {
  const deps: TextIngestionDeps = options.deps ?? {
    extractor: createPdfParseExtractorAdapter(),
    ocr: createGeminiOcrAdapter(),
    enable_ocr_fallback: options.enable_ocr_fallback !== false,
    min_chars_threshold:
      options.min_chars_threshold ?? DEFAULT_MIN_CHARS_THRESHOLD,
  };

  return new TextIngestionPipeline({
    ...deps,
    enable_ocr_fallback:
      options.enable_ocr_fallback ?? deps.enable_ocr_fallback ?? true,
    min_chars_threshold:
      options.min_chars_threshold ??
      deps.min_chars_threshold ??
      DEFAULT_MIN_CHARS_THRESHOLD,
  });
}

export async function ingestDocumentToTextProjection(input: {
  readonly source: SourceArtifact;
  readonly bytes: Uint8Array;
  readonly chunk?: boolean;
  readonly options?: GovernedTextIngestionOptions;
}): Promise<TextIngestionResult> {
  const pipeline = createGovernedTextIngestion(input.options);
  return pipeline.ingest(
    { source: input.source, bytes: input.bytes },
    { chunk: input.chunk === true },
  );
}
