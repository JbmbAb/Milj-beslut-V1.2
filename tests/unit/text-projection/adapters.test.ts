import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../server/modules/legal/services/legalCorpusTextExtractor', () => ({
  extractPdfBufferText: vi.fn(async () => 'Extraherad PDF-text från pdf-parse adapter.'),
}));

vi.mock('../../../server/text-projection/geminiOcrClient', () => ({
  OCR_MODEL: 'gemini-2.5-flash',
  OCR_MAX_FILE_BYTES: 12_000_000,
  runGeminiOcr: vi.fn(async () => 'OCR-text från Gemini-adapter.'),
}));

import { extractPdfBufferText } from '../../../server/modules/legal/services/legalCorpusTextExtractor';
import { runGeminiOcr } from '../../../server/text-projection/geminiOcrClient';
import {
  createPdfParseExtractorAdapter,
  createGeminiOcrAdapter,
  createGovernedTextIngestion,
  PDF_PARSE_ADAPTER_VERSION,
} from '../../../server/text-projection';

describe('TEXT-L2 server adapters', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('PdfParseExtractorAdapter returns ExtractionResult only with pinned version', async () => {
    const adapter = createPdfParseExtractorAdapter();
    const result = await adapter.extract(
      {
        ref: { artifact_id: 'a1' },
        doc_name: 'x.pdf',
        mime_type: 'application/pdf',
      },
      new Uint8Array([1, 2, 3]),
    );

    expect(extractPdfBufferText).toHaveBeenCalled();
    expect(result.method).toBe('pdf_parse');
    expect(result.version).toBe(PDF_PARSE_ADAPTER_VERSION);
    expect(result.succeeded).toBe(true);
    expect(result).not.toHaveProperty('content_hash');
    expect(result).not.toHaveProperty('projection_version');
  });

  it('GeminiOcrAdapter returns ExtractionResult with model version', async () => {
    const adapter = createGeminiOcrAdapter();
    const result = await adapter.ocr(
      {
        ref: { artifact_id: 'a2' },
        doc_name: 'scan.pdf',
        mime_type: 'application/pdf',
      },
      new Uint8Array([4, 5]),
    );

    expect(runGeminiOcr).toHaveBeenCalled();
    expect(result.method).toBe('ocr_gemini');
    expect(result.version).toBe('ocr_gemini:gemini-2.5-flash');
    expect(result.succeeded).toBe(true);
  });

  it('createGovernedTextIngestion is the single path to TextProjection', async () => {
    const pipeline = createGovernedTextIngestion({
      enable_ocr_fallback: false,
      min_chars_threshold: 10,
    });

    const result = await pipeline.ingest({
      source: {
        ref: { artifact_id: 'gov-1' },
        doc_name: 'Miljöbalken',
        source_system: 'sfs',
        mime_type: 'application/pdf',
      },
      bytes: new Uint8Array([9]),
    });

    expect(result.projection.contract_id).toBe('text_projection');
    expect(result.projection.extractor.kind).toBe('pdf-parse');
    expect(result.projection.extractor.version).toBe(PDF_PARSE_ADAPTER_VERSION);
    expect(result.classification.document_class).toBe('law');
  });
});
