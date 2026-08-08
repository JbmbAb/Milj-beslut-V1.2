import type {
  ExtractionResult,
  SourceArtifact,
  TextExtractorPort,
} from '@miljobeslut/mps-text-projection';
import { extractPdfBufferText } from '../modules/legal/services/legalCorpusTextExtractor';
import { PDF_PARSE_ADAPTER_VERSION, PLAIN_TEXT_ADAPTER_VERSION } from './versions';

/**
 * TEXT-L1 TextExtractorPort — pdf-parse (+ plain UTF-8 for text mime).
 * Does NOT build alternate projection formats; returns ExtractionResult only.
 */
export class PdfParseExtractorAdapter implements TextExtractorPort {
  async extract(source: SourceArtifact, bytes: Uint8Array): Promise<ExtractionResult> {
    const buffer = Buffer.from(bytes);
    const mime = String(source.mime_type || '').toLowerCase();

    if (
      mime.startsWith('text/') ||
      mime === 'application/json' ||
      mime === 'application/xml'
    ) {
      const text = buffer.toString('utf8');
      return {
        text,
        method: mime.includes('json')
          ? 'json'
          : mime.includes('html')
            ? 'html'
            : 'plain_text',
        version: PLAIN_TEXT_ADAPTER_VERSION,
        succeeded: text.length > 0,
        notes: text.length === 0 ? 'empty plain text' : undefined,
      };
    }

    // Default / PDF path
    try {
      const text = (await extractPdfBufferText(buffer)) ?? '';
      return {
        text,
        method: 'pdf_parse',
        version: PDF_PARSE_ADAPTER_VERSION,
        succeeded: text.length > 0,
        notes: text.length === 0 ? 'pdf-parse returned no text' : undefined,
      };
    } catch (err) {
      return {
        text: '',
        method: 'pdf_parse',
        version: PDF_PARSE_ADAPTER_VERSION,
        succeeded: false,
        notes: err instanceof Error ? err.message : 'pdf-parse failed',
      };
    }
  }
}

export function createPdfParseExtractorAdapter(): TextExtractorPort {
  return new PdfParseExtractorAdapter();
}
