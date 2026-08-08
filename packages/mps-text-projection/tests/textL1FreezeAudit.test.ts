import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildTextProjection,
  classifyDocument,
  TEXT_PROJECTION_VERSION,
  TextIngestionPipeline,
} from "../src/index.js";
import { chunkTextStructure } from "@miljobeslut/mps-chunking";

/**
 * TEXT-L1 — Text Projection Freeze gate.
 */
describe("TEXT-L1 Text Projection Freeze", () => {
  it("freeze surface fields are present and named", () => {
    const p = buildTextProjection({
      source: {
        ref: { artifact_id: "s1" },
        doc_name: "x.pdf",
      },
      text: "hello world ".repeat(20),
      steps: [
        {
          method: "pdf_parse",
          version: "pdf-parse@freeze",
          char_count: 240,
          succeeded: true,
        },
      ],
    });

    expect(p.projection_version).toBe(TEXT_PROJECTION_VERSION);
    expect(p.source_artifact_ref.artifact_id).toBe("s1");
    expect(typeof p.text).toBe("string");
    expect(p.extractor.kind).toBe("pdf-parse");
    expect(typeof p.extractor.version).toBe("string");
    expect(["complete", "partial", "failed"]).toContain(p.extraction_status);
    expect(typeof p.ocr_used).toBe("boolean");
    expect(p.content_hash.algorithm).toBe("sha256");
    expect(p.content_hash.value).toMatch(/^[a-f0-9]{64}$/);
  });

  it("same input + same extractor version → same projection hash", () => {
    const mk = () =>
      buildTextProjection({
        source: { ref: { artifact_id: "same" }, doc_name: "a.pdf" },
        text: "stable text body",
        steps: [
          {
            method: "pdf_parse",
            version: "pdf-parse@1.2.3",
            char_count: 16,
            succeeded: true,
          },
        ],
        projection_id: "stable",
      });
    expect(mk().content_hash.value).toBe(mk().content_hash.value);
  });

  it("mps-chunking consumes only text (+ classify handoff), not OCR internals", () => {
    const p = buildTextProjection({
      source: {
        ref: { artifact_id: "law" },
        doc_name: "Miljöbalken",
        source_system: "sfs",
      },
      text: "2 kap.\n6 § Verksamheten ska bedrivas.",
      steps: [
        {
          method: "ocr_gemini",
          version: "gemini-x",
          char_count: 40,
          succeeded: true,
        },
      ],
    });
    const c = classifyDocument(p);
    const chunks = chunkTextStructure({
      text: p.text,
      docName: p.doc_name,
      sourceSystem: p.source_system,
      source_artifact_ref: p.source_artifact_ref,
      kind: c.chunk_kind,
    });
    expect(chunks.chunks.length).toBeGreaterThan(0);
    // Chunk records must not embed extractor provenance
    const serialized = JSON.stringify(chunks.chunks);
    expect(serialized).not.toContain("ocr_gemini");
    expect(serialized).not.toContain("gemini-x");
  });

  it("classification is a separate artifact from projection", () => {
    const p = buildTextProjection({
      source: { ref: { artifact_id: "d" }, doc_name: "x" },
      text: "body",
      steps: [
        {
          method: "preextracted",
          version: "t",
          char_count: 4,
          succeeded: true,
        },
      ],
    });
    const c = classifyDocument(p);
    expect(p).not.toHaveProperty("document_class");
    expect(c).toHaveProperty("document_class");
    expect(c).toHaveProperty("classifier_version");
  });

  it("ADR TEXT-L1 documents the freeze gate", () => {
    const adr = readFileSync(
      resolve(__dirname, "../../../docs/architecture/ADR-TEXT-PROJECTION.md"),
      "utf8",
    );
    expect(adr).toMatch(/TEXT-L1/);
    expect(adr).toMatch(/TextProjection/);
    expect(adr).toMatch(/MUST NEVER mutate `?SourceArtifact/i);
  });

  it("pipeline preserves SourceArtifact bytes hash identity", async () => {
    const source = {
      ref: { artifact_id: "bytes-1" },
      doc_name: "scan.pdf",
      bytes_content_hash: {
        algorithm: "sha256" as const,
        value: "bb".repeat(32),
      },
    };
    const pipeline = new TextIngestionPipeline();
    await pipeline.ingest({
      source,
      preextracted_text: "y".repeat(200),
      preextracted_version: "fixture",
    });
    expect(source.bytes_content_hash.value).toBe("bb".repeat(32));
    expect(source.ref.artifact_id).toBe("bytes-1");
  });
});
