export {
  createPdfParseExtractorAdapter,
  PdfParseExtractorAdapter,
} from './pdfParseExtractorAdapter';
export { createGeminiOcrAdapter, GeminiOcrAdapter } from './geminiOcrAdapter';
export { createExternalOcrAdapter, ExternalOcrAdapter } from './externalOcrAdapter';
export { extractTextViaPorts, type PortExtractionOutcome } from './extractTextViaPorts';
export {
  createGovernedTextIngestion,
  ingestDocumentToTextProjection,
  type GovernedTextIngestionOptions,
} from './createGovernedTextIngestion';
export {
  PDF_PARSE_ADAPTER_VERSION,
  PLAIN_TEXT_ADAPTER_VERSION,
  GEMINI_OCR_ADAPTER_VERSION_PREFIX,
} from './versions';
export { OCR_MODEL, OCR_MAX_FILE_BYTES, runGeminiOcr } from './geminiOcrClient';
