export { LocalTesseractOcrAdapter } from "./LocalTesseractOcrAdapter.js";
export {
  createLocalOnPremTextIngestion,
  type LocalOnPremTextIngestionOptions,
} from "./createLocalOnPremTextIngestion.js";
export {
  DEFAULT_OCR_DPI,
  DEFAULT_OCR_LANGUAGE_SET,
  DEFAULT_WINDOWS_TESSERACT_PATH,
  SUPPORTED_LANGUAGE_SETS,
  languageList,
  resolveOnPath,
  resolveSystemTessdataDir,
  resolveTesseractPath,
  type LocalTesseractOcrConfig,
  type OcrLanguageSet,
} from "./config.js";
export { LocalOcrFailure, failureNote } from "./failures.js";
export {
  PopplerPdfPageRenderer,
  PdfRendererError,
  resolvePopplerPaths,
  type PdfPageRenderer,
} from "./pdfPageRenderer.js";
export {
  formatOcrVersion,
  joinPageTexts,
  normalizeOcrText,
  parsePdfinfoVersion,
  parsePopplerVersion,
  parseTesseractVersion,
} from "./provenanceIdentity.js";
export { PROCESS_SPAWN_OPTIONS, defaultSpawn } from "./processRunner.js";
export {
  composeTessdataDir,
  packagedTessdataDir,
  sha256File,
} from "./languageData.js";
