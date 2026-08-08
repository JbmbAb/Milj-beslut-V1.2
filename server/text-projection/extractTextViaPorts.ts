import type { SourceArtifact } from '@miljobeslut/mps-text-projection';
import { DEFAULT_MIN_CHARS_THRESHOLD } from '@miljobeslut/mps-text-projection';
import { createPdfParseExtractorAdapter } from './pdfParseExtractorAdapter';
import { createGeminiOcrAdapter } from './geminiOcrAdapter';
import { createExternalOcrAdapter } from './externalOcrAdapter';

export interface PortExtractionOutcome {
  readonly text: string;
  readonly primary_method: string;
  readonly primary_version: string;
  readonly ocr_used: boolean;
  readonly ocr_method?: string;
  readonly ocr_version?: string;
  readonly steps: ReadonlyArray<{
    method: string;
    version: string;
    char_count: number;
    succeeded: boolean;
  }>;
}

/**
 * TEXT-L2 — all server text extraction for PDF/images goes through ports.
 * Does not build TextProjection (that is TextProjectionBuilder only).
 */
export async function extractTextViaPorts(input: {
  readonly source: SourceArtifact;
  readonly bytes: Uint8Array;
  readonly min_chars_threshold?: number;
  readonly enable_ocr_fallback?: boolean;
  /** Prefer external OCR_ENDPOINT before Gemini when both available. */
  readonly prefer_external_ocr?: boolean;
}): Promise<PortExtractionOutcome> {
  const minChars = input.min_chars_threshold ?? DEFAULT_MIN_CHARS_THRESHOLD;
  const extractor = createPdfParseExtractorAdapter();
  const extracted = await extractor.extract(input.source, input.bytes);

  const steps: PortExtractionOutcome['steps'][number][] = [
    {
      method: extracted.method,
      version: extracted.version,
      char_count: extracted.text.length,
      succeeded: extracted.succeeded,
    },
  ];

  let text = extracted.text;
  let ocr_used = false;
  let ocr_method: string | undefined;
  let ocr_version: string | undefined;

  const enableOcr = input.enable_ocr_fallback !== false;
  if (enableOcr && text.length < minChars) {
    const ocrAdapters = input.prefer_external_ocr
      ? [createExternalOcrAdapter(), createGeminiOcrAdapter()]
      : [createGeminiOcrAdapter(), createExternalOcrAdapter()];

    for (const ocr of ocrAdapters) {
      const result = await ocr.ocr(input.source, input.bytes);
      steps.push({
        method: result.method,
        version: result.version,
        char_count: result.text.length,
        succeeded: result.succeeded,
      });
      if (result.succeeded && result.text.length > 0) {
        ocr_used = true;
        ocr_method = result.method;
        ocr_version = result.version;
        if (text.length > 0 && !result.text.includes(text)) {
          text = `${text}\n${result.text}`;
        } else {
          text = result.text;
        }
        break;
      }
    }
  }

  return {
    text,
    primary_method: extracted.method,
    primary_version: extracted.version,
    ocr_used,
    ...(ocr_method ? { ocr_method } : {}),
    ...(ocr_version ? { ocr_version } : {}),
    steps,
  };
}
