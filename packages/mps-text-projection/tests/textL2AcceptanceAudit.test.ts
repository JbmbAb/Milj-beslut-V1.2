import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  TextProjectionBuilder,
  classifyDocument,
  resolveChunkContract,
  TextIngestionPipeline,
  TEXT_PROJECTION_VERSION,
  type TextExtractorPort,
  type OcrPort,
} from "../src/index.js";
import {
  routeToCorrectChunker,
  chunkSwedishLaw,
  TEXT_CHUNK_VERSION,
} from "@miljobeslut/mps-chunking";

/**
 * TEXT-L2 — Adapter → Projection Integration acceptance gate.
 */
describe("TEXT-L2 Acceptance Gate", () => {
  it("only TextProjectionBuilder produces the freeze surface", () => {
    const source = {
      ref: { artifact_id: "l2-1" },
      doc_name: "x.pdf",
      bytes_content_hash: {
        algorithm: "sha256" as const,
        value: "cc".repeat(32),
      },
    };
    const projection = TextProjectionBuilder.build({
      source,
      text: "body ".repeat(40),
      steps: [
        {
          method: "pdf_parse",
          version: "pdf-parse@2.4.5",
          char_count: 200,
          succeeded: true,
        },
      ],
    });

    expect(projection.projection_version).toBe(TEXT_PROJECTION_VERSION);
    expect(projection.extractor.kind).toBe("pdf-parse");
    expect(projection.extraction_status).toBe("complete");
    expect(projection.ocr_used).toBe(false);
    expect(projection.content_hash.value).toMatch(/^[a-f0-9]{64}$/);
    expect(projection.source_artifact_ref.artifact_id).toBe("l2-1");
    expect(projection).not.toHaveProperty("document_class");
    // Source untouched
    expect(source.bytes_content_hash.value).toBe("cc".repeat(32));
  });

  it("document_class comes after projection via classifier + ChunkContractResolver", () => {
    const projection = TextProjectionBuilder.build({
      source: {
        ref: { artifact_id: "l2-law" },
        doc_name: "Miljöbalken",
        source_system: "sfs",
      },
      text: "1 kap.\n1 § Syftet.",
      steps: [
        {
          method: "preextracted",
          version: "t",
          char_count: 20,
          succeeded: true,
        },
      ],
    });
    const classification = classifyDocument(projection);
    const contract = resolveChunkContract(classification);

    expect(classification.document_class).toBe("law");
    expect(contract.chunk_kind).toBe("law");
    expect(contract.chunk_version).toBe(TEXT_CHUNK_VERSION);
    expect(contract.contract_label).toBe("text/law/v2.3");
  });

  it("same path + version → identical content_hash; OCR fallback explicit", async () => {
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
          text: "OCR path text ".repeat(15),
          method: "ocr_gemini",
          version: "ocr_gemini:gemini-2.5-flash",
          succeeded: true,
        };
      },
    };
    const pipeline = new TextIngestionPipeline({
      extractor,
      ocr,
      min_chars_threshold: 40,
      enable_ocr_fallback: true,
    });
    const source = {
      ref: { artifact_id: "l2-ocr" },
      doc_name: "scan.pdf",
      mime_type: "application/pdf",
    };

    const a = await pipeline.ingest({ source, bytes: new Uint8Array([1]) });
    const b = await pipeline.ingest({ source, bytes: new Uint8Array([1]) });

    expect(a.projection.ocr_used).toBe(true);
    expect(a.projection.ocr?.version).toBe("ocr_gemini:gemini-2.5-flash");
    expect(a.projection.content_hash.value).toBe(b.projection.content_hash.value);
    expect(a.projection.extraction.steps.map((s) => s.method)).toEqual([
      "pdf_parse",
      "ocr_gemini",
    ]);
  });

  it("semanticChunker re-export surface still works (compat)", () => {
    // Mirrors server/modules/legal/services/semanticChunker.ts exports
    const chunks = routeToCorrectChunker(
      "2 kap.\n6 § Verksamheten ska bedrivas.",
      "Miljöbalken",
      "sfs",
    );
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunkSwedishLaw("1 kap.\n1 § Test.").length).toBeGreaterThan(0);
  });

  it("ADR TEXT-L2 documents the gate; no L3 full migration claimed", () => {
    const adr = readFileSync(
      resolve(__dirname, "../../../docs/architecture/ADR-TEXT-L2-Adapter-Projection.md"),
      "utf8",
    );
    expect(adr).toMatch(/TEXT-L2/);
    expect(adr).toMatch(/TextProjectionBuilder/);
    expect(adr).toMatch(/ChunkContractResolver/);
    expect(adr).toMatch(/out of scope/i);
    expect(adr).toMatch(/full corpus/i);
  });

  it("server extract paths are port-wired (static evidence)", () => {
    const search = readFileSync(
      resolve(__dirname, "../../../server/services/searchService.ts"),
      "utf8",
    );
    const ocr = readFileSync(
      resolve(__dirname, "../../../server/services/ocrService.ts"),
      "utf8",
    );
    const corpus = readFileSync(
      resolve(
        __dirname,
        "../../../server/modules/legal/services/legalCorpusTextExtractor.ts",
      ),
      "utf8",
    );

    expect(search).toMatch(/extractTextViaPorts/);
    expect(search).not.toMatch(/await import\('pdf-parse'\)/);
    expect(ocr).toMatch(/extractTextViaPorts/);
    expect(corpus).toMatch(/createPdfParseExtractorAdapter/);
  });
});
