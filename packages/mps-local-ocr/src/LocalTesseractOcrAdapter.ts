import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type {
  ExtractionResult,
  OcrPort,
  SourceArtifact,
} from "@miljobeslut/mps-text-projection";
import {
  DEFAULT_OCR_DPI,
  DEFAULT_OCR_LANGUAGE_SET,
  DEFAULT_OCR_MAX_CAPTURE_BYTES,
  DEFAULT_OCR_MAX_INPUT_BYTES,
  DEFAULT_OCR_MAX_PAGES,
  DEFAULT_OCR_OEM,
  DEFAULT_OCR_PSM,
  DEFAULT_OCR_TIMEOUT_MS,
  languageList,
  resolveSystemTessdataDir,
  resolveTesseractPath,
  type LocalTesseractOcrConfig,
  type OcrLanguageSet,
} from "./config.js";
import { failureNote, LocalOcrFailure, type LocalOcrFailureCode } from "./failures.js";
import {
  composeTessdataDir,
  LanguageDataError,
  packagedTessdataDir,
  type LanguageFileIdentity,
} from "./languageData.js";
import {
  PopplerPdfPageRenderer,
  PdfRendererError,
  resolvePopplerPaths,
  type PdfPageRenderer,
} from "./pdfPageRenderer.js";
import {
  defaultSpawn,
  runProcess,
  type ProcessRunResult,
  type SpawnFn,
} from "./processRunner.js";
import {
  formatOcrVersion,
  joinPageTexts,
  normalizeOcrText,
  parseTesseractVersion,
} from "./provenanceIdentity.js";

type InputKind = "pdf" | "png" | "jpeg" | "tiff" | "bmp" | "webp";

interface ResolvedSettings {
  readonly tesseractPath: string;
  readonly languages: OcrLanguageSet;
  readonly dpi: number;
  readonly oem: number;
  readonly psm: number;
  readonly timeoutMs: number;
  readonly maxPages: number;
  readonly maxInputBytes: number;
  readonly tempParentDir: string;
  readonly packagedTessdataDir: string;
  readonly spawnFn: SpawnFn;
}

export class LocalTesseractOcrAdapter implements OcrPort {
  constructor(private readonly config: LocalTesseractOcrConfig = {}) {}

  async ocr(source: SourceArtifact, bytes: Uint8Array): Promise<ExtractionResult> {
    const settings = this.settings();
    const unresolved = this.unresolvedVersion(settings.languages);

    if (bytes.byteLength === 0) {
      return this.failed(
        unresolved,
        LocalOcrFailure.UNSUPPORTED_INPUT,
        "input is empty",
      );
    }
    if (bytes.byteLength > settings.maxInputBytes) {
      return this.failed(
        unresolved,
        LocalOcrFailure.INPUT_TOO_LARGE,
        `input is ${bytes.byteLength} bytes`,
      );
    }

    const kind = classifyInput(bytes, source.mime_type);
    if (!kind) {
      return this.failed(
        unresolved,
        LocalOcrFailure.UNSUPPORTED_INPUT,
        `mime ${source.mime_type ?? "unknown"} is not a supported image or PDF`,
      );
    }

    if (!existsSync(settings.tesseractPath)) {
      return this.failed(
        unresolved,
        LocalOcrFailure.EXECUTABLE_MISSING,
        settings.tesseractPath,
      );
    }

    let workDir: string | null = null;
    let outcome: ExtractionResult | undefined;
    try {
      workDir = await mkdtemp(path.join(settings.tempParentDir, "mimer-ocr-"));
      await mkdir(path.join(workDir, "tessdata"), { recursive: true });
      const languageFiles = await composeTessdataDir({
        languages: languageList(settings.languages),
        destinationDir: path.join(workDir, "tessdata"),
        packagedDir: settings.packagedTessdataDir,
        systemTessdataDir: resolveSystemTessdataDir(
          settings.tesseractPath,
          this.config.systemTessdataDir,
        ),
      });
      const tesseractVersion = await this.probeTesseractVersion(settings, workDir);
      if (!tesseractVersion.ok) {
        outcome = this.failed(unresolved, tesseractVersion.code, tesseractVersion.detail);
      } else if (kind === "pdf") {
        outcome = await this.ocrPdf(
          bytes,
          settings,
          workDir,
          languageFiles,
          tesseractVersion.version,
        );
      } else {
        const extension = extensionFor(kind);
        const imagePath = path.join(workDir, `input.${extension}`);
        await writeFile(imagePath, bytes);
        const page = await this.ocrImage(settings, workDir, imagePath, path.join(workDir, "ocr"));
        const version = this.version({
          settings,
          tesseractVersion: tesseractVersion.version,
          languageFiles,
          rendererId: "none",
          renderFormat: "none",
          dpi: null,
        });
        outcome = page.ok
          ? {
              text: normalizeOcrText(page.text),
              method: "ocr_tesseract",
              version,
              succeeded: true,
              page_count: 1,
            }
          : this.failed(version, page.code, page.detail);
      }
    } catch (err) {
      if (err instanceof LanguageDataError || err instanceof PdfRendererError) {
        outcome = this.failed(unresolved, err.code, err.detail);
      } else {
        outcome = this.failed(
          unresolved,
          LocalOcrFailure.SPAWN_ERROR,
          err instanceof Error ? err.message : "local OCR failed",
        );
      }
    } finally {
      if (workDir) {
        try {
          await removeWorkDir(workDir, this.config.removeWorkDirectory);
        } catch (err) {
          const prior = outcome?.succeeded
            ? "succeeded"
            : (outcome?.notes ?? "no result");
          outcome = this.failed(
            outcome?.version ?? unresolved,
            LocalOcrFailure.TEMP_CLEANUP_FAILED,
            `${err instanceof Error ? err.message : "temp directory remains"}; prior ${prior}`,
          );
        }
      }
    }
    return (
      outcome ??
      this.failed(unresolved, LocalOcrFailure.SPAWN_ERROR, "local OCR produced no result")
    );
  }

  private async ocrPdf(
    bytes: Uint8Array,
    settings: ResolvedSettings,
    workDir: string,
    languageFiles: readonly LanguageFileIdentity[],
    tesseractVersion: string,
  ): Promise<ExtractionResult> {
    const renderer = await this.resolveRenderer(settings);
    if (!renderer) {
      return this.failed(
        this.version({
          settings,
          tesseractVersion,
          languageFiles,
          rendererId: "none",
          renderFormat: "none",
          dpi: settings.dpi,
        }),
        LocalOcrFailure.RENDERER_MISSING,
        "local PDF renderer is not configured",
      );
    }

    let rendererId = renderer.id;
    try {
      rendererId = await renderer.probeIdentity();
      const pdfPath = path.join(workDir, "input.pdf");
      await writeFile(pdfPath, bytes);
      const pageCount = await renderer.pageCount(pdfPath, settings.timeoutMs);
      if (pageCount > settings.maxPages) {
        return this.failed(
          this.version({
            settings,
            tesseractVersion,
            languageFiles,
            rendererId,
            renderFormat: "png",
            dpi: settings.dpi,
          }),
          LocalOcrFailure.PAGE_LIMIT,
          `pdf has ${pageCount} pages; max is ${settings.maxPages}`,
          pageCount,
        );
      }

      const pages: string[] = [];
      for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
        const outputBase = path.join(workDir, `page-${pageNumber}`);
        const imagePath = await renderer.renderPage({
          pdfPath,
          pageNumber,
          outputBase,
          dpi: settings.dpi,
          timeoutMs: settings.timeoutMs,
        });
        const page = await this.ocrImage(settings, workDir, imagePath, outputBase);
        await unlink(imagePath).catch(() => undefined);
        await unlink(`${outputBase}.txt`).catch(() => undefined);
        if (!page.ok) {
          return this.failed(
            this.version({
              settings,
              tesseractVersion,
              languageFiles,
              rendererId,
              renderFormat: "png",
              dpi: settings.dpi,
            }),
            page.code,
            `page ${pageNumber}: ${page.detail}`,
            pageCount,
          );
        }
        pages.push(page.text);
      }

      return {
        text: joinPageTexts(pages),
        method: "ocr_tesseract",
        version: this.version({
          settings,
          tesseractVersion,
          languageFiles,
          rendererId,
          renderFormat: "png",
          dpi: settings.dpi,
        }),
        succeeded: true,
        page_count: pageCount,
      };
    } catch (err) {
      if (err instanceof PdfRendererError) {
        return this.failed(
          this.version({
            settings,
            tesseractVersion,
            languageFiles,
            rendererId,
            renderFormat: "png",
            dpi: settings.dpi,
          }),
          err.code,
          err.detail,
        );
      }
      return this.failed(
        this.version({
          settings,
          tesseractVersion,
          languageFiles,
          rendererId,
          renderFormat: "png",
          dpi: settings.dpi,
        }),
        LocalOcrFailure.RENDERER_FAILED,
        err instanceof Error ? err.message : "renderer failed",
      );
    }
  }

  private async ocrImage(
    settings: ResolvedSettings,
    workDir: string,
    imagePath: string,
    outputBase: string,
  ): Promise<{ ok: true; text: string } | { ok: false; code: LocalOcrFailureCode; detail: string }> {
    const outputTxt = `${outputBase}.txt`;
    await unlink(outputTxt).catch(() => undefined);
    const args = [
      imagePath,
      outputBase,
      "-l",
      settings.languages,
      "--oem",
      String(settings.oem),
      "--psm",
      String(settings.psm),
      "--tessdata-dir",
      path.join(workDir, "tessdata"),
    ];
    const result = await runProcess(settings.spawnFn, settings.tesseractPath, args, {
      cwd: workDir,
      timeoutMs: settings.timeoutMs,
      maxCaptureBytes: DEFAULT_OCR_MAX_CAPTURE_BYTES,
    });
    const mapped = mapProcessFailure(result, "tesseract");
    if (mapped) return mapped;
    let raw: string;
    try {
      raw = await readFile(outputTxt, "utf8");
    } catch {
      return {
        ok: false,
        code: LocalOcrFailure.OUTPUT_MISSING,
        detail: "tesseract exited 0 without writing a new output file",
      };
    }
    return { ok: true, text: raw };
  }

  private async probeTesseractVersion(
    settings: ResolvedSettings,
    workDir: string,
  ): Promise<{ ok: true; version: string } | { ok: false; code: LocalOcrFailureCode; detail: string }> {
    const result = await runProcess(settings.spawnFn, settings.tesseractPath, ["--version"], {
      cwd: workDir,
      timeoutMs: settings.timeoutMs,
      maxCaptureBytes: DEFAULT_OCR_MAX_CAPTURE_BYTES,
    });
    const mapped = mapProcessFailure(result, "tesseract --version");
    if (mapped) return mapped;
    const version = parseTesseractVersion(`${result.stderr}\n${result.stdout}`);
    if (!version) {
      return {
        ok: false,
        code: LocalOcrFailure.SPAWN_ERROR,
        detail: "tesseract --version did not report a version",
      };
    }
    return { ok: true, version };
  }

  private async resolveRenderer(settings: ResolvedSettings): Promise<PdfPageRenderer | null> {
    if (this.config.renderer === null) return null;
    if (this.config.renderer) return this.config.renderer;
    const paths = resolvePopplerPaths({
      pdftoppmPath: this.config.pdftoppmPath,
      pdfinfoPath: this.config.pdfinfoPath,
    });
    if (!paths) return null;
    return new PopplerPdfPageRenderer(paths, settings.spawnFn);
  }

  private settings(): ResolvedSettings {
    const languages = this.config.languages ?? DEFAULT_OCR_LANGUAGE_SET;
    return {
      tesseractPath: resolveTesseractPath(this.config.tesseractPath) ?? "",
      languages,
      dpi: this.config.dpi ?? DEFAULT_OCR_DPI,
      oem: this.config.oem ?? DEFAULT_OCR_OEM,
      psm: this.config.psm ?? DEFAULT_OCR_PSM,
      timeoutMs: this.config.timeoutMs ?? DEFAULT_OCR_TIMEOUT_MS,
      maxPages: this.config.maxPages ?? DEFAULT_OCR_MAX_PAGES,
      maxInputBytes: this.config.maxInputBytes ?? DEFAULT_OCR_MAX_INPUT_BYTES,
      tempParentDir: this.config.tempParentDir ?? tmpdir(),
      packagedTessdataDir: this.config.packagedTessdataDir ?? packagedTessdataDir(),
      spawnFn: this.config.spawn ?? defaultSpawn,
    };
  }

  private unresolvedVersion(languages: OcrLanguageSet): string {
    return formatOcrVersion({
      tesseractVersion: "unresolved",
      languages,
      languageFiles: [],
      oem: this.config.oem ?? DEFAULT_OCR_OEM,
      psm: this.config.psm ?? DEFAULT_OCR_PSM,
      dpi: null,
      rendererId: "none",
      renderFormat: "none",
    });
  }

  private version(input: {
    readonly settings: ResolvedSettings;
    readonly tesseractVersion: string;
    readonly languageFiles: readonly LanguageFileIdentity[];
    readonly rendererId: string;
    readonly renderFormat: string;
    readonly dpi: number | null;
  }): string {
    return formatOcrVersion({
      tesseractVersion: input.tesseractVersion,
      languages: input.settings.languages,
      languageFiles: input.languageFiles,
      oem: input.settings.oem,
      psm: input.settings.psm,
      dpi: input.dpi,
      rendererId: input.rendererId,
      renderFormat: input.renderFormat,
    });
  }

  private failed(
    version: string,
    code: LocalOcrFailureCode,
    detail: string,
    pageCount?: number,
  ): ExtractionResult {
    return {
      text: "",
      method: "ocr_tesseract",
      version,
      succeeded: false,
      notes: failureNote(code, detail),
      ...(typeof pageCount === "number" ? { page_count: pageCount } : {}),
    };
  }
}

function mapProcessFailure(
  result: ProcessRunResult,
  label: string,
): { ok: false; code: LocalOcrFailureCode; detail: string } | null {
  if (result.timedOut) {
    return { ok: false, code: LocalOcrFailure.TIMEOUT, detail: `${label} exceeded the time limit` };
  }
  if (result.spawnError) {
    const missing = /ENOENT/i.test(result.spawnError);
    return {
      ok: false,
      code: missing ? LocalOcrFailure.EXECUTABLE_MISSING : LocalOcrFailure.SPAWN_ERROR,
      detail: result.spawnError,
    };
  }
  if (result.code !== 0) {
    return {
      ok: false,
      code: LocalOcrFailure.NONZERO_EXIT,
      detail: `${label} exit ${String(result.code)} ${result.stderr}`.trim(),
    };
  }
  return null;
}

function classifyInput(bytes: Uint8Array, mime: string | undefined): InputKind | null {
  const byMagic = magicKind(bytes);
  const byMime = mimeKind(mime);
  if (byMime && byMagic && byMime !== byMagic) return null;
  return byMime ?? byMagic;
}

function mimeKind(mime: string | undefined): InputKind | null {
  switch ((mime ?? "").toLowerCase()) {
    case "application/pdf":
      return "pdf";
    case "image/png":
      return "png";
    case "image/jpeg":
    case "image/jpg":
      return "jpeg";
    case "image/tiff":
    case "image/tif":
      return "tiff";
    case "image/bmp":
      return "bmp";
    case "image/webp":
      return "webp";
    case "":
      return null;
    default:
      return null;
  }
}

function magicKind(bytes: Uint8Array): InputKind | null {
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46])) return "pdf";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47])) return "png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "jpeg";
  if (startsWith(bytes, [0x49, 0x49, 0x2a, 0x00]) || startsWith(bytes, [0x4d, 0x4d, 0x00, 0x2a])) {
    return "tiff";
  }
  if (startsWith(bytes, [0x42, 0x4d])) return "bmp";
  if (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    bytes.length >= 12 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "webp";
  }
  return null;
}

function startsWith(bytes: Uint8Array, prefix: readonly number[]): boolean {
  if (bytes.length < prefix.length) return false;
  return prefix.every((value, index) => bytes[index] === value);
}

function extensionFor(kind: Exclude<InputKind, "pdf">): string {
  switch (kind) {
    case "png":
      return "png";
    case "jpeg":
      return "jpg";
    case "tiff":
      return "tif";
    case "bmp":
      return "bmp";
    case "webp":
      return "webp";
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

async function removeWorkDir(
  workDir: string,
  removeWorkDirectory?: (directory: string) => Promise<void>,
): Promise<void> {
  let lastDetail = "temp directory could not be removed";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      if (removeWorkDirectory) {
        await removeWorkDirectory(workDir);
      } else {
        await rm(workDir, { recursive: true, force: true });
      }
      if (!existsSync(workDir)) return;
      lastDetail = "temp directory still exists after removal";
    } catch (err) {
      lastDetail = err instanceof Error ? err.message : "temp directory removal failed";
    }
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error(lastDetail);
}
