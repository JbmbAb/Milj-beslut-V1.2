import { existsSync } from "node:fs";
import path from "node:path";
import type { SpawnFn } from "./processRunner.js";
import type { PdfPageRenderer } from "./pdfPageRenderer.js";

/**
 * Discovery fallback for the verified Windows install.
 * This path is runtime configuration only. It is not part of OCR provenance.
 */
export const DEFAULT_WINDOWS_TESSERACT_PATH =
  "C:\\Program Files\\Tesseract-OCR\\tesseract.exe";

export const SUPPORTED_LANGUAGE_SETS = ["swe", "eng", "swe+eng"] as const;
export type OcrLanguageSet = (typeof SUPPORTED_LANGUAGE_SETS)[number];

/**
 * Default for Swedish Mimer documents.
 * The body text is Swedish, while identifiers and technical tokens are often
 * Latin/English. swe is the required Swedish model; eng is the model already
 * installed with Tesseract 5.4. swe+eng binds both into one tessdata directory.
 */
export const DEFAULT_OCR_LANGUAGE_SET: OcrLanguageSet = "swe+eng";

export const DEFAULT_OCR_DPI = 300;
export const DEFAULT_OCR_OEM = 1;
export const DEFAULT_OCR_PSM = 3;
export const DEFAULT_OCR_TIMEOUT_MS = 120_000;
export const DEFAULT_OCR_MAX_PAGES = 100;
export const DEFAULT_OCR_MAX_CAPTURE_BYTES = 8_192;
export const DEFAULT_OCR_MAX_INPUT_BYTES = 50 * 1024 * 1024;

export interface LocalTesseractOcrConfig {
  readonly tesseractPath?: string;
  readonly languages?: OcrLanguageSet;
  readonly packagedTessdataDir?: string;
  readonly systemTessdataDir?: string;
  readonly pdftoppmPath?: string;
  readonly pdfinfoPath?: string;
  readonly dpi?: number;
  readonly oem?: number;
  readonly psm?: number;
  readonly timeoutMs?: number;
  readonly maxPages?: number;
  readonly maxInputBytes?: number;
  readonly tempParentDir?: string;
  readonly spawn?: SpawnFn;
  /** When omitted, Poppler is discovered. Pass null to refuse PDF rendering. */
  readonly renderer?: PdfPageRenderer | null;
  /**
   * Removes one OCR work directory. Unset uses a recursive delete.
   * If the directory still exists afterwards, the OCR call fails closed.
   */
  readonly removeWorkDirectory?: (workDir: string) => Promise<void>;
}

export function isOcrLanguageSet(value: string): value is OcrLanguageSet {
  switch (value) {
    case "swe":
    case "eng":
    case "swe+eng":
      return true;
    default:
      return false;
  }
}

export function languageList(set: OcrLanguageSet): readonly string[] {
  switch (set) {
    case "swe":
      return ["swe"];
    case "eng":
      return ["eng"];
    case "swe+eng":
      return ["swe", "eng"];
    default: {
      const _exhaustive: never = set;
      return _exhaustive;
    }
  }
}

export function resolveTesseractPath(explicit?: string): string | null {
  const fromArg = explicit?.trim();
  if (fromArg) return fromArg;
  const fromEnv = process.env.TESSERACT_PATH?.trim();
  if (fromEnv) return fromEnv;
  if (process.platform === "win32" && existsSync(DEFAULT_WINDOWS_TESSERACT_PATH)) {
    return DEFAULT_WINDOWS_TESSERACT_PATH;
  }
  return null;
}

export function resolveOnPath(basename: string): string | null {
  const pathEnv = process.env.PATH ?? "";
  const extension = process.platform === "win32" ? ".exe" : "";
  for (const dir of pathEnv.split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, `${basename}${extension}`);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export function resolveSystemTessdataDir(
  tesseractPath: string,
  explicit?: string,
): string | null {
  const fromArg = explicit?.trim();
  if (fromArg) return fromArg;
  const prefix = process.env.TESSDATA_PREFIX?.trim();
  if (prefix) {
    const nested = path.join(prefix, "tessdata");
    if (existsSync(nested)) return nested;
    if (existsSync(path.join(prefix, "eng.traineddata"))) return prefix;
  }
  const beside = path.join(path.dirname(tesseractPath), "tessdata");
  if (existsSync(beside)) return beside;
  return null;
}
