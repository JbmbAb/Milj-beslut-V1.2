import { describe, it, expect } from "vitest";
import {
  TextIngestionPipeline,
  type TextExtractorPort,
  type OcrPort,
} from "../src/index.js";

describe("TEXT-L1 port contract → single projection builder", () => {
  const source = {
    ref: { artifact_id: "port-doc-1", artifact_type: "document" },
    doc_name: "bilaga.pdf",
    mime_type: "application/pdf",
  };

  it("same extraction path + version → identical content_hash", async () => {
    const extractor: TextExtractorPort = {
      async extract() {
        return {
          text: "Stabil extraktionstext för determinism ".repeat(5),
          method: "pdf_parse",
          version: "pdf-parse@2.4.5",
          succeeded: true,
        };
      },
    };

    const pipeline = new TextIngestionPipeline({
      extractor,
      enable_ocr_fallback: false,
      min_chars_threshold: 20,
    });

    const a = await pipeline.ingest({ source, bytes: new Uint8Array([1]) });
    const b = await pipeline.ingest({ source, bytes: new Uint8Array([1]) });

    expect(a.projection.content_hash.value).toBe(b.projection.content_hash.value);
    expect(a.projection.extractor).toEqual({
      kind: "pdf-parse",
      version: "pdf-parse@2.4.5",
    });
    expect(a.projection.ocr_used).toBe(false);
    expect(a.projection.extraction_status).toBe("complete");
  });

  it("OCR-fallback path is explicit and stable for same OCR version", async () => {
    const extractor: TextExtractorPort = {
      async extract() {
        return {
          text: "kort",
          method: "pdf_parse",
          version: "pdf-parse@2.4.5",
          succeeded: true,
        };
      },
    };
    const ocr: OcrPort = {
      async ocr() {
        return {
          text: "OCR-stabil text ".repeat(20),
          method: "ocr_gemini",
          version: "ocr_gemini:gemini-2.5-flash",
          succeeded: true,
        };
      },
    };

    const pipeline = new TextIngestionPipeline({
      extractor,
      ocr,
      enable_ocr_fallback: true,
      min_chars_threshold: 40,
    });

    const a = await pipeline.ingest({ source, bytes: new Uint8Array([9]) });
    const b = await pipeline.ingest({ source, bytes: new Uint8Array([9]) });

    expect(a.projection.ocr_used).toBe(true);
    expect(a.projection.ocr?.version).toBe("ocr_gemini:gemini-2.5-flash");
    expect(a.projection.content_hash.value).toBe(b.projection.content_hash.value);
    expect(a.projection.extraction.steps.map((s) => s.method)).toEqual([
      "pdf_parse",
      "ocr_gemini",
    ]);
  });

  it("does not invent a second projection format from adapters", async () => {
    const extractor: TextExtractorPort = {
      async extract() {
        return {
          text: "x".repeat(150),
          method: "pdf_parse",
          version: "pdf-parse@2.4.5",
          succeeded: true,
        };
      },
    };
    const pipeline = new TextIngestionPipeline({ extractor, enable_ocr_fallback: false });
    const result = await pipeline.ingest({ source, bytes: new Uint8Array([1]) });

    expect(result.projection.contract_id).toBe("text_projection");
    expect(result.projection.projection_version).toBe("v1.0");
    expect(result.projection).not.toHaveProperty("document_class");
  });
});
