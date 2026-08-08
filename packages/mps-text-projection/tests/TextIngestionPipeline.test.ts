import { describe, it, expect } from "vitest";
import {
  TextIngestionPipeline,
  type TextExtractorPort,
  type OcrPort,
} from "../src/index.js";

describe("TextIngestionPipeline", () => {
  const source = {
    ref: { artifact_id: "scan-1" },
    doc_name: "skannad-bilaga.pdf",
    mime_type: "application/pdf",
    source_system: "upload",
  };

  it("falls back to OCR when extract is below threshold", async () => {
    const extractor: TextExtractorPort = {
      async extract() {
        return {
          text: "kort",
          method: "pdf_parse",
          version: "pdf-parse@test",
          succeeded: true,
        };
      },
    };
    const ocr: OcrPort = {
      async ocr() {
        return {
          text: "Detta är OCR-text som är tillräckligt lång för full completeness threshold.",
          method: "ocr_gemini",
          version: "gemini-test",
          succeeded: true,
        };
      },
    };

    const pipeline = new TextIngestionPipeline({
      extractor,
      ocr,
      min_chars_threshold: 20,
      enable_ocr_fallback: true,
    });

    const result = await pipeline.ingest({
      source,
      bytes: new Uint8Array([1, 2, 3]),
    });

    expect(result.projection.extraction.ocr_used).toBe(true);
    expect(result.projection.extraction.steps).toHaveLength(2);
    expect(result.projection.text).toContain("OCR-text");
    expect(result.classification.chunk_kind).toBe("standard");
  });

  it("handoff to mps-chunking when chunk:true", async () => {
    const pipeline = new TextIngestionPipeline();
    const result = await pipeline.ingest(
      {
        source: {
          ref: { artifact_id: "law-2" },
          doc_name: "Miljöbalken",
          source_system: "sfs",
        },
        preextracted_text:
          "2 kap.\n6 § Verksamheten ska bedrivas så att olägenheter begränsas.",
        preextracted_version: "fixture",
      },
      { chunk: true },
    );

    expect(result.classification.document_class).toBe("law");
    expect(result.chunks).toBeDefined();
    expect(result.chunks!.chunks.length).toBeGreaterThan(0);
    expect(result.chunks!.chunks[0]?.chunk_version).toBe("v2.3");
    expect(result.chunks!.chunks[0]?.source_artifact_ref.artifact_id).toBe(
      "law-2",
    );
  });

  it("rejects extraction without port or preextracted text", async () => {
    const pipeline = new TextIngestionPipeline();
    await expect(
      pipeline.ingest({ source, bytes: new Uint8Array([1]) }),
    ).rejects.toThrow(/REJECT_TEXT_INGESTION/);
  });
});
