import type {
  ExtractionResult,
  SourceArtifact,
  TextExtractorPort,
} from '@miljobeslut/mps-text-projection';
import { extractHtmlDocumentText, extractPdfBufferText } from '../modules/legal/services/legalCorpusTextExtractor';
import { HTML_EXTRACT_ADAPTER_VERSION, PDF_PARSE_ADAPTER_VERSION, PLAIN_TEXT_ADAPTER_VERSION } from './versions';

/**
 * TEXT-L1 TextExtractorPort — pdf-parse (+ plain UTF-8 for text mime).
 * Does NOT build alternate projection formats; returns ExtractionResult only.
 */
export class PdfParseExtractorAdapter implements TextExtractorPort {
  async extract(source: SourceArtifact, bytes: Uint8Array): Promise<ExtractionResult> {
    const buffer = Buffer.from(bytes);
    const mime = String(source.mime_type || '').toLowerCase();

    if (mime === 'text/html') {
      const raw = buffer.toString('utf8');
      // LEGAL-CORPUS-MATERIALIZATION-V1: raw quarantine bytes (`bytes`/`buffer` above) are never
      // touched -- this only changes what TEXT-L1 projects from them. Presentation markup
      // (including anything a server injects into an attribute or navigation shell on every
      // render) is stripped here so it can never reach corpus text or the projection hash;
      // reusing the existing tag-stripper rather than a new extractor, per the same rule this
      // codebase already applies to raw acquisition: no second parallel implementation.
      const { documentText } = extractHtmlDocumentText(raw);
      const text = documentText ?? '';
      return {
        text,
        method: 'html',
        version: HTML_EXTRACT_ADAPTER_VERSION,
        succeeded: text.length > 0,
        notes: text.length === 0 ? 'empty html text after tag stripping' : undefined,
      };
    }

    if (
      mime.startsWith('text/') ||
      mime === 'application/json' ||
      mime === 'application/xml'
    ) {
      const text = buffer.toString('utf8');
      return {
        text,
        method: mime.includes('json') ? 'json' : 'plain_text',
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
