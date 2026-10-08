import { writeFileSync } from "node:fs";
import { readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_WINDOWS_TESSERACT_PATH,
  LocalOcrFailure,
  LocalTesseractOcrAdapter,
  PROCESS_SPAWN_OPTIONS,
  resolveTesseractPath,
} from "../src/index.js";
import {
  SOURCE,
  TINY_PNG,
  makeTempParent,
  nodeChild,
  versionedSpawn,
  writeBadSweDir,
  writeOcrText,
} from "./support.js";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

describe("LocalTesseractOcrAdapter", () => {
  it("discovers TESSERACT_PATH ahead of the Windows default", () => {
    const previous = process.env.TESSERACT_PATH;
    process.env.TESSERACT_PATH = "D:\\custom\\tesseract.exe";
    try {
      expect(resolveTesseractPath()).toBe("D:\\custom\\tesseract.exe");
    } finally {
      restoreEnv("TESSERACT_PATH", previous);
    }
  });

  it("discovers the installed local executable when TESSERACT_PATH is unset", () => {
    const previous = process.env.TESSERACT_PATH;
    delete process.env.TESSERACT_PATH;
    try {
      expect(resolveTesseractPath()).toBe(DEFAULT_WINDOWS_TESSERACT_PATH);
    } finally {
      restoreEnv("TESSERACT_PATH", previous);
    }
  });

  it("spawns processes without a shell", () => {
    expect(PROCESS_SPAWN_OPTIONS.shell).toBe(false);
  });

  it("reads a local image with the installed Tesseract", async () => {
    const tempParentDir = await makeTempParent();
    const bytes = await readFile(path.join(FIXTURES, "eng-hello.png"));
    const adapter = new LocalTesseractOcrAdapter({
      languages: "eng",
      tempParentDir,
    });
    const result = await adapter.ocr(
      { ...SOURCE, mime_type: "image/png", doc_name: "eng-hello.png" },
      bytes,
    );
    expect(result.succeeded).toBe(true);
    expect(result.method).toBe("ocr_tesseract");
    expect(result.text).toMatch(/HELLO/);
    expect(result.text).toMatch(/OCR/);
    expect(result.version).toContain("tesseract@5.4.0");
    expect(result.version).toContain("langs=eng");
    expect(result.version).toContain("sha256:");
    expect(await readdir(tempParentDir)).toEqual([]);
  });

  it("reads a Swedish fixture with the pinned swe model", async () => {
    const tempParentDir = await makeTempParent();
    const bytes = await readFile(path.join(FIXTURES, "swe-forsiktighet.png"));
    const adapter = new LocalTesseractOcrAdapter({
      languages: "swe",
      tempParentDir,
    });
    const result = await adapter.ocr(
      { ...SOURCE, mime_type: "image/png", doc_name: "swe.png" },
      bytes,
    );
    expect(result.succeeded).toBe(true);
    expect(result.text.toLowerCase()).toMatch(/försikt|forsikt/);
    expect(result.version).toContain("langs=swe");
    expect(result.version).toContain(
      "swe=tessdata-4.1.0:sha256:24e2dd15cc0088d211c5f1bd49971e600317f201502deadbc417f0ffd6c9a6f8",
    );
  });

  it("mutation: pretend Tesseract succeeded after non-zero exit", async () => {
    const tempParentDir = await makeTempParent();
    const adapter = new LocalTesseractOcrAdapter({
      tesseractPath: DEFAULT_WINDOWS_TESSERACT_PATH,
      languages: "swe",
      tempParentDir,
      spawn: versionedSpawn("5.4.0.20240606", (args) => {
        writeOcrText(args, "SHOULD-NOT-USE");
      }, 2),
    });
    const result = await adapter.ocr(SOURCE, TINY_PNG);
    expect(result.succeeded).toBe(false);
    expect(result.text).toBe("");
    expect(result.notes).toContain(LocalOcrFailure.NONZERO_EXIT);
    expect(result.text).not.toContain("SHOULD-NOT-USE");
    expect(await readdir(tempParentDir)).toEqual([]);
  });

  it("mutation: ignore missing executable", async () => {
    const adapter = new LocalTesseractOcrAdapter({
      tesseractPath: "D:\\missing\\tesseract.exe",
      languages: "eng",
    });
    const result = await adapter.ocr(SOURCE, TINY_PNG);
    expect(result.succeeded).toBe(false);
    expect(result.text).toBe("");
    expect(result.notes).toContain(LocalOcrFailure.EXECUTABLE_MISSING);
  });

  it("mutation: ignore OCR timeout", async () => {
    const tempParentDir = await makeTempParent();
    const adapter = new LocalTesseractOcrAdapter({
      tesseractPath: DEFAULT_WINDOWS_TESSERACT_PATH,
      languages: "swe",
      timeoutMs: 300,
      tempParentDir,
      spawn: (_command, args) => {
        if (args[0] === "--version") {
          return nodeChild("setInterval(() => {}, 1000);");
        }
        return nodeChild("setInterval(() => {}, 1000);");
      },
    });
    const result = await adapter.ocr(SOURCE, TINY_PNG);
    expect(result.succeeded).toBe(false);
    expect(result.text).toBe("");
    expect(result.notes).toContain(LocalOcrFailure.TIMEOUT);
    expect(await readdir(tempParentDir)).toEqual([]);
  }, 10_000);

  it("rejects malformed input", async () => {
    const adapter = new LocalTesseractOcrAdapter({
      tesseractPath: DEFAULT_WINDOWS_TESSERACT_PATH,
    });
    const result = await adapter.ocr(
      { ...SOURCE, mime_type: "application/octet-stream" },
      new Uint8Array([1, 2, 3, 4]),
    );
    expect(result.succeeded).toBe(false);
    expect(result.notes).toContain(LocalOcrFailure.UNSUPPORTED_INPUT);
  });

  it("mutation: reuse stale temp output", async () => {
    const tempParentDir = await makeTempParent();
    const adapter = new LocalTesseractOcrAdapter({
      tesseractPath: DEFAULT_WINDOWS_TESSERACT_PATH,
      languages: "swe",
      tempParentDir,
      spawn: versionedSpawn("5.4.0.20240606", (args) => {
        writeFileSync(`${args[1]}.stale.txt`, "STALE-OUTPUT");
      }),
    });
    const result = await adapter.ocr(SOURCE, TINY_PNG);
    expect(result.succeeded).toBe(false);
    expect(result.text).not.toContain("STALE-OUTPUT");
    expect(result.notes).toContain(LocalOcrFailure.OUTPUT_MISSING);
  });

  it("fails closed when the work directory remains after cleanup", async () => {
    const tempParentDir = await makeTempParent();
    const adapter = new LocalTesseractOcrAdapter({
      tesseractPath: DEFAULT_WINDOWS_TESSERACT_PATH,
      languages: "swe",
      tempParentDir,
      spawn: versionedSpawn("5.4.0.20240606", (args) => {
        writeOcrText(args, "hemlig text som inte far returneras");
      }),
      removeWorkDirectory: async () => {
        // Leave the work directory, including the written input bytes, in place.
      },
    });
    const result = await adapter.ocr(SOURCE, TINY_PNG);
    expect(result.succeeded).toBe(false);
    expect(result.text).toBe("");
    expect(result.notes).toContain(LocalOcrFailure.TEMP_CLEANUP_FAILED);
    const leftovers = (await readdir(tempParentDir)).filter((name) =>
      name.startsWith("mimer-ocr-"),
    );
    expect(leftovers).toHaveLength(1);
    await rm(tempParentDir, { recursive: true, force: true });
  });

  it("cleans temporary files after success", async () => {
    const tempParentDir = await makeTempParent();
    const adapter = new LocalTesseractOcrAdapter({
      tesseractPath: DEFAULT_WINDOWS_TESSERACT_PATH,
      languages: "swe",
      tempParentDir,
      spawn: versionedSpawn("5.4.0.20240606", (args) => {
        writeOcrText(args, "ren text");
      }),
    });
    const result = await adapter.ocr(SOURCE, TINY_PNG);
    expect(result.succeeded).toBe(true);
    expect(result.text).toBe("ren text");
    expect(await readdir(tempParentDir)).toEqual([]);
  });

  it("rejects a Swedish model whose bytes do not match the manifest", async () => {
    const tempParentDir = await makeTempParent();
    let spawned = false;
    const adapter = new LocalTesseractOcrAdapter({
      tesseractPath: DEFAULT_WINDOWS_TESSERACT_PATH,
      languages: "swe",
      packagedTessdataDir: await writeBadSweDir(tempParentDir),
      tempParentDir,
      spawn: () => {
        spawned = true;
        return nodeChild("process.exit(0);");
      },
    });
    const result = await adapter.ocr(SOURCE, TINY_PNG);
    expect(result.succeeded).toBe(false);
    expect(result.notes).toContain(LocalOcrFailure.LANGUAGE_DATA_HASH_MISMATCH);
    expect(spawned).toBe(false);
    const names = await readdir(tempParentDir);
    expect(names.filter((name) => name.startsWith("mimer-ocr-"))).toEqual([]);
  });
});

function restoreEnv(name: string, previous: string | undefined): void {
  if (previous === undefined) delete process.env[name];
  else process.env[name] = previous;
}
