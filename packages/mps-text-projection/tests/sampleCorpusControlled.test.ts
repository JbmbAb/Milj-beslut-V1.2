import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  TextIngestionPipeline,
  type TextExtractorPort,
  type OcrPort,
} from "../src/index.js";

const FIXTURE_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures/sample-corpus",
);

interface SampleEntry {
  id: string;
  file: string;
  doc_name: string;
  source_system?: string;
  evidence_doc_type?: string;
  force_ocr_path?: boolean;
  expected_class: string;
  expected_chunk_kind: string;
}

describe("Controlled sample corpus (pre-rechunk gate)", () => {
  const manifest = JSON.parse(
    readFileSync(resolve(FIXTURE_DIR, "manifest.json"), "utf8"),
  ) as SampleEntry[];

  it("runs projection → classification → v2.3 chunks for all sample types", async () => {
    const report: Array<Record<string, unknown>> = [];

    for (const entry of manifest) {
      const body = readFileSync(resolve(FIXTURE_DIR, entry.file), "utf8");

      const extractor: TextExtractorPort = {
        async extract() {
          if (entry.force_ocr_path) {
            return {
              text: "kort",
              method: "pdf_parse",
              version: "pdf-parse@2.4.5",
              succeeded: true,
            };
          }
          return {
            text: body,
            method: "pdf_parse",
            version: "pdf-parse@2.4.5",
            succeeded: true,
          };
        },
      };

      const ocr: OcrPort = {
        async ocr() {
          return {
            text: body,
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

      const result = await pipeline.ingest(
        {
          source: {
            ref: { artifact_id: entry.id, artifact_type: "sample_document" },
            doc_name: entry.doc_name,
            source_system: entry.source_system,
            evidence_doc_type: entry.evidence_doc_type,
            mime_type: "application/pdf",
          },
          bytes: Buffer.from(body, "utf8"),
        },
        { chunk: true },
      );

      expect(result.projection.projection_version).toBe("v1.0");
      expect(result.projection.content_hash.value).toMatch(/^[a-f0-9]{64}$/);
      expect(result.classification.document_class).toBe(entry.expected_class);
      expect(result.classification.chunk_kind).toBe(entry.expected_chunk_kind);
      expect(result.chunks).toBeDefined();
      expect(result.chunks!.chunks.length).toBeGreaterThan(0);
      expect(result.chunks!.chunks[0]?.chunk_version).toBe("v2.3");
      expect(result.chunks!.chunks[0]?.source_artifact_ref.artifact_id).toBe(
        entry.id,
      );

      if (entry.force_ocr_path) {
        expect(result.projection.ocr_used).toBe(true);
      }

      // Chunks must not embed OCR/extractor internals
      const chunkJson = JSON.stringify(result.chunks!.chunks);
      expect(chunkJson).not.toContain("ocr_gemini");
      expect(chunkJson).not.toContain("pdf-parse@");

      report.push({
        id: entry.id,
        class: result.classification.document_class,
        chunk_kind: result.classification.chunk_kind,
        chunk_count: result.chunks!.chunks.length,
        content_hash: result.projection.content_hash.value,
        ocr_used: result.projection.ocr_used,
        extraction_status: result.projection.extraction_status,
      });
    }

    expect(report).toHaveLength(manifest.length);
    // Stable sample set identity
    expect(report.map((r) => r.id)).toEqual(manifest.map((m) => m.id));
  });
});
