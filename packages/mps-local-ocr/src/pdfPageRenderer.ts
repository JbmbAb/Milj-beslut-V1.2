import { access } from "node:fs/promises";
import path from "node:path";
import { LocalOcrFailure, type LocalOcrFailureCode } from "./failures.js";
import { parsePdfinfoVersion, parsePopplerVersion } from "./provenanceIdentity.js";
import { defaultSpawn, runProcess, type SpawnFn } from "./processRunner.js";
import { resolveOnPath } from "./config.js";

export interface PdfRenderRequest {
  readonly pdfPath: string;
  readonly pageNumber: number;
  readonly outputBase: string;
  readonly dpi: number;
  readonly timeoutMs: number;
}

export interface PdfPageRenderer {
  readonly id: string;
  probeIdentity(): Promise<string>;
  pageCount(pdfPath: string, timeoutMs: number): Promise<number>;
  renderPage(request: PdfRenderRequest): Promise<string>;
}

export class PdfRendererError extends Error {
  constructor(
    readonly code: LocalOcrFailureCode,
    readonly detail: string,
  ) {
    super(`${code}: ${detail}`);
    this.name = "PdfRendererError";
  }
}

export function resolvePopplerPaths(explicit?: {
  readonly pdftoppmPath?: string;
  readonly pdfinfoPath?: string;
}): { readonly pdftoppmPath: string; readonly pdfinfoPath: string } | null {
  const pdftoppm =
    explicit?.pdftoppmPath?.trim() ||
    process.env.POPPLER_PDFTOPPM_PATH?.trim() ||
    resolveOnPath("pdftoppm");
  if (!pdftoppm) return null;
  const pdfinfo =
    explicit?.pdfinfoPath?.trim() ||
    process.env.POPPLER_PDFINFO_PATH?.trim() ||
    path.join(path.dirname(pdftoppm), process.platform === "win32" ? "pdfinfo.exe" : "pdfinfo");
  return { pdftoppmPath: pdftoppm, pdfinfoPath: pdfinfo };
}

export class PopplerPdfPageRenderer implements PdfPageRenderer {
  readonly id = "pdftoppm";
  private identity: string | null = null;

  constructor(
    private readonly paths: { readonly pdftoppmPath: string; readonly pdfinfoPath: string },
    private readonly spawnFn: SpawnFn = defaultSpawn,
    private readonly maxCaptureBytes = 8_192,
  ) {}

  async probeIdentity(): Promise<string> {
    if (this.identity) return this.identity;
    const pdftoppmVersion = await this.readToolVersion(
      this.paths.pdftoppmPath,
      "pdftoppm",
      parsePopplerVersion,
    );
    const pdfinfoVersion = await this.readToolVersion(
      this.paths.pdfinfoPath,
      "pdfinfo",
      parsePdfinfoVersion,
    );
    this.identity = `pdftoppm@${pdftoppmVersion}+pdfinfo@${pdfinfoVersion}`;
    return this.identity;
  }

  private async readToolVersion(
    executable: string,
    label: "pdftoppm" | "pdfinfo",
    parse: (output: string) => string | null,
  ): Promise<string> {
    const result = await runProcess(this.spawnFn, executable, ["-v"], {
      timeoutMs: 15_000,
      maxCaptureBytes: this.maxCaptureBytes,
    });
    if (result.timedOut) {
      throw new PdfRendererError(LocalOcrFailure.TIMEOUT, `${label} -v timed out`);
    }
    if (result.spawnError) {
      throw new PdfRendererError(LocalOcrFailure.RENDERER_MISSING, result.spawnError);
    }
    const version = parse(`${result.stderr}\n${result.stdout}`);
    if (!version || result.code !== 0) {
      throw new PdfRendererError(
        LocalOcrFailure.RENDERER_FAILED,
        `${label} -v exit ${String(result.code)}`,
      );
    }
    return version;
  }

  async pageCount(pdfPath: string, timeoutMs: number): Promise<number> {
    const result = await runProcess(this.spawnFn, this.paths.pdfinfoPath, [pdfPath], {
      timeoutMs,
      maxCaptureBytes: this.maxCaptureBytes,
    });
    if (result.timedOut) {
      throw new PdfRendererError(LocalOcrFailure.TIMEOUT, "pdfinfo timed out");
    }
    if (result.spawnError || result.code !== 0) {
      throw new PdfRendererError(
        LocalOcrFailure.RENDERER_FAILED,
        result.spawnError || result.stderr || `pdfinfo exit ${String(result.code)}`,
      );
    }
    const match = /^Pages:\s+(\d+)\s*$/m.exec(result.stdout.replace(/\r/g, ""));
    const count = match ? Number(match[1]) : Number.NaN;
    if (!Number.isInteger(count) || count < 1) {
      throw new PdfRendererError(
        LocalOcrFailure.RENDERER_FAILED,
        "pdfinfo did not report a page count",
      );
    }
    return count;
  }

  async renderPage(request: PdfRenderRequest): Promise<string> {
    const args = [
      "-png",
      "-r",
      String(request.dpi),
      "-f",
      String(request.pageNumber),
      "-l",
      String(request.pageNumber),
      "-singlefile",
      request.pdfPath,
      request.outputBase,
    ];
    const result = await runProcess(this.spawnFn, this.paths.pdftoppmPath, args, {
      timeoutMs: request.timeoutMs,
      maxCaptureBytes: this.maxCaptureBytes,
    });
    if (result.timedOut) {
      throw new PdfRendererError(
        LocalOcrFailure.TIMEOUT,
        `pdftoppm page ${request.pageNumber} timed out`,
      );
    }
    if (result.spawnError || result.code !== 0) {
      throw new PdfRendererError(
        LocalOcrFailure.RENDERER_FAILED,
        result.spawnError || result.stderr || `pdftoppm exit ${String(result.code)}`,
      );
    }
    const imagePath = `${request.outputBase}.png`;
    try {
      await access(imagePath);
    } catch {
      throw new PdfRendererError(
        LocalOcrFailure.RENDERER_FAILED,
        `pdftoppm did not write ${imagePath}`,
      );
    }
    return imagePath;
  }
}
