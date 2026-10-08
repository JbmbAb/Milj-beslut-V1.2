import { readdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_WINDOWS_TESSERACT_PATH,
  LocalOcrFailure,
  LocalTesseractOcrAdapter,
  PopplerPdfPageRenderer,
  type PdfPageRenderer,
} from "../src/index.js";
import {
  SOURCE,
  TINY_PNG,
  buildSimplePdf,
  makeTempParent,
  nodeChild,
  versionedSpawn,
  writeOcrText,
} from "./support.js";

describe("local PDF OCR", () => {
  it("mutation: reverse PDF page ordering", async () => {
    const seen = { maxPng: 0, order: [] as number[] };
    const tempParentDir = await makeTempParent();
    const adapter = new LocalTesseractOcrAdapter({
      tesseractPath: DEFAULT_WINDOWS_TESSERACT_PATH,
      languages: "swe",
      tempParentDir,
      renderer: fakeRenderer(seen, 2),
      spawn: versionedSpawn("5.4.0.20240606", (args, cwd) => {
        const pngs = readdirSync(cwd ?? ".").filter((name) => /^page-\d+\.png$/.test(name));
        seen.maxPng = Math.max(seen.maxPng, pngs.length);
        const image = String(args[0]);
        writeOcrText(args, image.includes("page-1") ? "ALPHA" : "BETA");
      }),
    });
    const result = await adapter.ocr(pdfSource(), Buffer.from("%PDF-1.4\n"));
    expect(result.succeeded).toBe(true);
    expect(seen.order).toEqual([1, 2]);
    expect(result.text.indexOf("ALPHA")).toBeGreaterThanOrEqual(0);
    expect(result.text.indexOf("ALPHA")).toBeLessThan(result.text.indexOf("BETA"));
    expect(result.page_count).toBe(2);
    expect(result.version).toContain("renderer=fake-renderer@1");
    expect(result.version).toContain("dpi=300");
    expect(result.version).toContain("render=png");
  });

  it("keeps multi-page rendering to one page image at a time", async () => {
    const seen = { maxPng: 0, order: [] as number[] };
    const tempParentDir = await makeTempParent();
    const adapter = new LocalTesseractOcrAdapter({
      tesseractPath: DEFAULT_WINDOWS_TESSERACT_PATH,
      languages: "swe",
      tempParentDir,
      maxPages: 3,
      renderer: fakeRenderer(seen, 3),
      spawn: versionedSpawn("5.4.0.20240606", (args, cwd) => {
        const pngs = readdirSync(cwd ?? ".").filter((name) => /^page-\d+\.png$/.test(name));
        seen.maxPng = Math.max(seen.maxPng, pngs.length);
        writeOcrText(args, "sida");
      }),
    });
    const result = await adapter.ocr(pdfSource(), Buffer.from("%PDF-1.4\n"));
    expect(result.succeeded).toBe(true);
    expect(seen.maxPng).toBe(1);
    expect(seen.order).toEqual([1, 2, 3]);
  });

  it("fails closed when the page count exceeds the bound", async () => {
    const seen = { maxPng: 0, order: [] as number[] };
    const tempParentDir = await makeTempParent();
    const adapter = new LocalTesseractOcrAdapter({
      tesseractPath: DEFAULT_WINDOWS_TESSERACT_PATH,
      languages: "swe",
      tempParentDir,
      maxPages: 1,
      renderer: fakeRenderer(seen, 2),
      spawn: versionedSpawn("5.4.0.20240606", (args) => {
        writeOcrText(args, "should-not-run");
      }),
    });
    const result = await adapter.ocr(pdfSource(), Buffer.from("%PDF-1.4\n"));
    expect(result.succeeded).toBe(false);
    expect(result.text).toBe("");
    expect(result.notes).toContain(LocalOcrFailure.PAGE_LIMIT);
    expect(seen.order).toEqual([]);
  });

  it("mutation: renderer failure fails closed", async () => {
    const tempParentDir = await makeTempParent();
    let ocrSpawned = false;
    const adapter = new LocalTesseractOcrAdapter({
      tesseractPath: DEFAULT_WINDOWS_TESSERACT_PATH,
      languages: "swe",
      tempParentDir,
      renderer: {
        id: "fake-renderer@1",
        async probeIdentity() {
          return "fake-renderer@1";
        },
        async pageCount() {
          return 1;
        },
        async renderPage() {
          throw new Error("render-broke");
        },
      },
      spawn: versionedSpawn("5.4.0.20240606", () => {
        ocrSpawned = true;
      }),
    });
    const result = await adapter.ocr(pdfSource(), Buffer.from("%PDF-1.4\n"));
    expect(result.succeeded).toBe(false);
    expect(result.text).toBe("");
    expect(result.notes).toContain(LocalOcrFailure.RENDERER_FAILED);
    expect(result.notes).toContain("render-broke");
    expect(ocrSpawned).toBe(false);
  });

  it("renders a scanned PDF with local Poppler and preserves page order", async () => {
    const tempParentDir = await makeTempParent();
    const pdf = buildSimplePdf(["PAGE ALPHA", "PAGE BETA"]);
    const adapter = new LocalTesseractOcrAdapter({
      languages: "eng",
      dpi: 200,
      tempParentDir,
    });
    const result = await adapter.ocr(pdfSource(), pdf);
    expect(result.succeeded).toBe(true);
    expect(result.page_count).toBe(2);
    expect(result.version).toContain("renderer=pdftoppm@25.07.0+pdfinfo@25.07.0");
    expect(result.version).toContain("dpi=200");
    expect(result.version).toContain("render=png");
    expect(result.text.toUpperCase().indexOf("ALPHA")).toBeGreaterThanOrEqual(0);
    expect(result.text.toUpperCase().indexOf("ALPHA")).toBeLessThan(
      result.text.toUpperCase().indexOf("BETA"),
    );
  });

  it("binds pdfinfo separately from pdftoppm in the renderer identity", async () => {
    const renderer = new PopplerPdfPageRenderer(
      { pdftoppmPath: "C:\\poppler\\pdftoppm.exe", pdfinfoPath: "D:\\other\\pdfinfo.exe" },
      (command) => {
        const tool = command.includes("pdfinfo") ? "pdfinfo" : "pdftoppm";
        const version = tool === "pdfinfo" ? "24.02.0" : "25.07.0";
        return nodeChild(
          `process.stderr.write(${JSON.stringify(`${tool} version ${version}\n`)}); process.exit(0);`,
        );
      },
    );
    await expect(renderer.probeIdentity()).resolves.toBe(
      "pdftoppm@25.07.0+pdfinfo@24.02.0",
    );
  });

  it("fails closed when Poppler cannot render the PDF", async () => {
    const tempParentDir = await makeTempParent();
    const adapter = new LocalTesseractOcrAdapter({
      languages: "eng",
      tempParentDir,
    });
    const result = await adapter.ocr(pdfSource(), Buffer.from("%PDF-1.4\nnot-a-real-pdf"));
    expect(result.succeeded).toBe(false);
    expect(result.text).toBe("");
    expect(result.notes).toContain(LocalOcrFailure.RENDERER_FAILED);
  });
});

function pdfSource() {
  return { ...SOURCE, mime_type: "application/pdf", doc_name: "scan.pdf" };
}

function fakeRenderer(
  seen: { order: number[] },
  pages: number,
): PdfPageRenderer {
  return {
    id: "fake-renderer@1",
    async probeIdentity() {
      return "fake-renderer@1";
    },
    async pageCount() {
      return pages;
    },
    async renderPage(request) {
      seen.order.push(request.pageNumber);
      const imagePath = `${request.outputBase}.png`;
      await writeFile(imagePath, TINY_PNG);
      return imagePath;
    },
  };
}
