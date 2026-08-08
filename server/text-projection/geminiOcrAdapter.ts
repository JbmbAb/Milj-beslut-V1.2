import type {
  ExtractionResult,
  OcrPort,
  SourceArtifact,
} from '@miljobeslut/mps-text-projection';
import { OCR_MODEL, runGeminiOcr } from './geminiOcrClient';
import { GEMINI_OCR_ADAPTER_VERSION_PREFIX } from './versions';

function ocrVersion(): string {
  return `${GEMINI_OCR_ADAPTER_VERSION_PREFIX}${OCR_MODEL}`;
}

/**
 * TEXT-L2 OcrPort — wraps Gemini OCR client.
 * Returns ExtractionResult only; never invents TextProjection shapes.
 */
export class GeminiOcrAdapter implements OcrPort {
  async ocr(source: SourceArtifact, bytes: Uint8Array): Promise<ExtractionResult> {
    const mime = source.mime_type || 'application/pdf';
    const version = ocrVersion();
    try {
      const text = await runGeminiOcr(Buffer.from(bytes), mime);
      if (!text) {
        return {
          text: '',
          method: 'ocr_gemini',
          version,
          succeeded: false,
          notes: 'OCR unavailable or empty (missing API key / size limit / API error)',
        };
      }
      return {
        text,
        method: 'ocr_gemini',
        version,
        succeeded: true,
      };
    } catch (err) {
      return {
        text: '',
        method: 'ocr_gemini',
        version,
        succeeded: false,
        notes: err instanceof Error ? err.message : 'OCR failed',
      };
    }
  }
}

export function createGeminiOcrAdapter(): OcrPort {
  return new GeminiOcrAdapter();
}
