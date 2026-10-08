import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { TextExtractorPort } from "@miljobeslut/mps-text-projection";
import {
  DEFAULT_WINDOWS_TESSERACT_PATH,
  LocalOcrFailure,
  createLocalOnPremTextIngestion,
} from "../src/index.js";
import { SOURCE, TINY_PNG, makeTempParent, nodeChild, versionedSpawn, writeOcrText } from "./support.js";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src");

describe("local on-prem network isolation", () => {
  it("mutation: permit external OCR fallback", async () => {
    const calls: string[] = [];
    const originalFetch = globalThis.fetch;
    const previousEndpoint = process.env.OCR_ENDPOINT;
    const previousModel = process.env.GEMINI_OCR_MODEL;
    const previousKey = process.env.OCR_API_KEY;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      calls.push(String(input));
      throw new Error("NETWORK_FORBIDDEN");
    }) as typeof fetch;
    process.env.OCR_ENDPOINT = "http://127.0.0.1:9/ocr";
    process.env.GEMINI_OCR_MODEL = "gemini-2.5-flash";
    process.env.OCR_API_KEY = "secret";

    try {
      const pipeline = createLocalOnPremTextIngestion({
        extractor: shortExtractor(),
        min_chars_threshold: 20,
        ocrConfig: {
          tesseractPath: "D:\\missing\\tesseract.exe",
          languages: "swe",
        },
      });
      const result = await pipeline.ingest({
        source: { ...SOURCE, mime_type: "image/png" },
        bytes: TINY_PNG,
      });
      const ocrStep = result.projection.extraction.steps.find(
        (step) => step.method === "ocr_tesseract",
      );
      expect(ocrStep?.succeeded).toBe(false);
      expect(result.projection.ocr_used).toBe(false);
      expect(calls).toEqual([]);
      expect(ocrStep?.version ?? "").not.toMatch(/gemini|vertex|endpoint/i);
    } finally {
      globalThis.fetch = originalFetch;
      restore("OCR_ENDPOINT", previousEndpoint);
      restore("GEMINI_OCR_MODEL", previousModel);
      restore("OCR_API_KEY", previousKey);
    }
  });

  it("does not reference an external OCR client in the local adapter sources", () => {
    const files = readdirSync(SRC).filter((name) => name.endsWith(".ts"));
    const combined = files
      .map((name) => readFileSync(path.join(SRC, name), "utf8"))
      .join("\n");
    expect(combined).not.toMatch(/OCR_ENDPOINT/);
    expect(combined).not.toMatch(/GEMINI_OCR_MODEL/);
    expect(combined).not.toMatch(/OCR_API_KEY/);
    expect(combined).not.toMatch(/vertexai|googleapis|generative-ai/i);
    expect(combined).not.toMatch(/\bfetch\s*\(/);
  });
});

describe("local on-prem pipeline", () => {
  it("mutation: OCR an extractable PDF unnecessarily", async () => {
    let spawned = 0;
    const pipeline = createLocalOnPremTextIngestion({
      extractor: longExtractor(),
      min_chars_threshold: 20,
      ocrConfig: {
        tesseractPath: DEFAULT_WINDOWS_TESSERACT_PATH,
        spawn: () => {
          spawned += 1;
          return nodeChild("process.exit(0);");
        },
      },
    });
    const result = await pipeline.ingest({
      source: SOURCE,
      bytes: TINY_PNG,
    });
    expect(spawned).toBe(0);
    expect(result.projection.ocr_used).toBe(false);
    expect(result.projection.contract_id).toBe("text_projection");
    expect(result.projection.extractor.kind).toBe("pdf-parse");
  });

  it("invokes local OCR when extraction is insufficient and projects the text", async () => {
    const tempParentDir = await makeTempParent();
    const pipeline = createLocalOnPremTextIngestion({
      extractor: shortExtractor(),
      min_chars_threshold: 20,
      ocrConfig: {
        tesseractPath: DEFAULT_WINDOWS_TESSERACT_PATH,
        languages: "swe+eng",
        tempParentDir,
        spawn: versionedSpawn("5.4.0.20240606", (args) => {
          writeOcrText(args, "Detta är lokal OCR-text som är tillräckligt lång för projektionen.");
        }),
      },
    });
    const bytes = Uint8Array.from(TINY_PNG);
    const before = Buffer.from(bytes);
    const source = {
      ...SOURCE,
      bytes_content_hash: { algorithm: "sha256" as const, value: "cd".repeat(32) },
    };
    const result = await pipeline.ingest({ source, bytes });
    expect(result.projection.contract_id).toBe("text_projection");
    expect(result.projection.ocr_used).toBe(true);
    expect(result.projection.text).toContain("lokal OCR-text");
    expect(result.projection.ocr?.kind).toBe("ocr");
    expect(result.projection.ocr?.version).toContain("tesseract@5.4.0.20240606");
    expect(result.projection.ocr?.version).toContain("langs=swe+eng");
    expect(result.projection.ocr?.version).toContain("sha256:");
    expect(source.bytes_content_hash.value).toBe("cd".repeat(32));
    expect(Buffer.from(bytes).equals(before)).toBe(true);
    expect(result.projection.content_hash.value).not.toBe(source.bytes_content_hash.value);
  });

  it("repeats the same fixture and engine configuration to the same projection hash", async () => {
    const run = () =>
      createLocalOnPremTextIngestion({
        extractor: shortExtractor(),
        min_chars_threshold: 20,
        ocrConfig: {
          tesseractPath: DEFAULT_WINDOWS_TESSERACT_PATH,
          languages: "swe",
          dpi: 300,
          spawn: versionedSpawn("5.4.0.20240606", (args) => {
            writeOcrText(args, "samma text");
          }),
        },
      }).ingest({ source: SOURCE, bytes: TINY_PNG });
    const first = await run();
    const second = await run();
    expect(first.projection.content_hash.value).toBe(second.projection.content_hash.value);
    expect(first.projection.ocr?.version).toBe(second.projection.ocr?.version);
  });

  it("mutation: bypass OCR provenance", async () => {
    const pipeline = createLocalOnPremTextIngestion({
      extractor: emptyExtractor(),
      min_chars_threshold: 20,
      ocrConfig: {
        tesseractPath: DEFAULT_WINDOWS_TESSERACT_PATH,
        languages: "swe",
        spawn: versionedSpawn("5.4.0.20240606", (args) => {
          writeOcrText(args, "bara ocr text som är lång nog för en fullständig projektion");
        }),
      },
    });
    const result = await pipeline.ingest({ source: SOURCE, bytes: TINY_PNG });
    expect(result.projection.extractor.kind).toBe("ocr");
    expect(result.projection.extractor.version).toContain("tesseract@");
    expect(result.projection.extractor.version).toContain("langs=swe");
    expect(result.projection.ocr?.version).toContain("models=");
    expect(result.projection.extraction.steps.map((step) => step.method)).toContain(
      "ocr_tesseract",
    );
  });

  it("mutation: omit language identity and change engine version", async () => {
    const ingest = (version: string) =>
      createLocalOnPremTextIngestion({
        extractor: shortExtractor(),
        min_chars_threshold: 20,
        ocrConfig: {
          tesseractPath: DEFAULT_WINDOWS_TESSERACT_PATH,
          languages: "swe+eng",
          spawn: versionedSpawn(version, (args) => {
            writeOcrText(args, "samma normaliserade text");
          }),
        },
      }).ingest({ source: SOURCE, bytes: TINY_PNG });
    const current = await ingest("5.4.0.20240606");
    const other = await ingest("5.3.0.test");
    expect(current.projection.content_hash.value).toBe(other.projection.content_hash.value);
    expect(current.projection.ocr?.version).toContain("langs=swe+eng");
    expect(current.projection.ocr?.version).toContain("swe=tessdata-4.1.0:sha256:");
    expect(current.projection.ocr?.version).toContain("eng=installed:sha256:");
    expect(current.projection.ocr?.version).not.toBe(other.projection.ocr?.version);
    expect(other.projection.ocr?.version).toContain("tesseract@5.3.0.test");
  });

  it("mutation: alter original source hash based on OCR text", async () => {
    const source = {
      ...SOURCE,
      bytes_content_hash: { algorithm: "sha256" as const, value: "ef".repeat(32) },
    };
    const bytes = Uint8Array.from(TINY_PNG);
    const pipeline = createLocalOnPremTextIngestion({
      extractor: shortExtractor(),
      min_chars_threshold: 20,
      ocrConfig: {
        tesseractPath: DEFAULT_WINDOWS_TESSERACT_PATH,
        languages: "swe",
        spawn: versionedSpawn("5.4.0.20240606", (args) => {
          writeOcrText(args, "ny text som inte får ändra källhashen i källobjektet");
        }),
      },
    });
    await pipeline.ingest({ source, bytes });
    expect(source.bytes_content_hash.value).toBe("ef".repeat(32));
    expect(source.ref.artifact_id).toBe("local-ocr-1");
  });
});

function shortExtractor(): TextExtractorPort {
  return {
    async extract() {
      return {
        text: "kort",
        method: "pdf_parse",
        version: "pdf-parse@test",
        succeeded: true,
      };
    },
  };
}

function emptyExtractor(): TextExtractorPort {
  return {
    async extract() {
      return {
        text: "",
        method: "pdf_parse",
        version: "pdf-parse@test",
        succeeded: false,
      };
    },
  };
}

function longExtractor(): TextExtractorPort {
  return {
    async extract() {
      return {
        text: "Denna PDF har redan tillräckligt med extraherbar text och ska inte OCR-behandlas.",
        method: "pdf_parse",
        version: "pdf-parse@test",
        succeeded: true,
      };
    },
  };
}

function restore(name: string, previous: string | undefined): void {
  if (previous === undefined) delete process.env[name];
  else process.env[name] = previous;
}
