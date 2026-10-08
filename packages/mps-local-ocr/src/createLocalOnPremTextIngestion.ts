import {
  TextIngestionPipeline,
  type TextExtractorPort,
  type TextIngestionDeps,
} from "@miljobeslut/mps-text-projection";
import { LocalTesseractOcrAdapter } from "./LocalTesseractOcrAdapter.js";
import type { LocalTesseractOcrConfig } from "./config.js";

export interface LocalOnPremTextIngestionOptions {
  readonly extractor: TextExtractorPort;
  readonly ocrConfig?: LocalTesseractOcrConfig;
  readonly min_chars_threshold?: number;
  readonly enable_ocr_fallback?: boolean;
}

/**
 * On-prem ingestion. The only OCR implementation this factory can construct
 * is LocalTesseractOcrAdapter. It has no network client and no second provider.
 */
export function createLocalOnPremTextIngestion(
  options: LocalOnPremTextIngestionOptions,
): TextIngestionPipeline {
  const deps: TextIngestionDeps = {
    extractor: options.extractor,
    ocr: new LocalTesseractOcrAdapter(options.ocrConfig),
    enable_ocr_fallback: options.enable_ocr_fallback !== false,
    ...(typeof options.min_chars_threshold === "number"
      ? { min_chars_threshold: options.min_chars_threshold }
      : {}),
  };
  return new TextIngestionPipeline(deps);
}
