import { describe, it, expect } from "vitest";
import {
  buildTextProjection,
  TEXT_PROJECTION_VERSION,
} from "../src/index.js";

describe("TextProjection determinism (TEXT-L1)", () => {
  const source = {
    ref: { artifact_id: "doc-1", artifact_type: "document" },
    doc_name: "Miljöbalken",
    source_system: "sfs",
    bytes_content_hash: {
      algorithm: "sha256" as const,
      value: "aa".repeat(32),
    },
  };

  it("same text + steps → identical content_hash and freeze surface", () => {
    const steps = [
      {
        method: "pdf_parse" as const,
        version: "pdf-parse@1.0",
        char_count: 20,
        succeeded: true,
      },
    ];
    const a = buildTextProjection({
      source,
      text: "1 kap.\n1 § Syftet.",
      steps,
      projection_id: "fixed-id",
    });
    const b = buildTextProjection({
      source,
      text: "1 kap.\n1 § Syftet.",
      steps,
      projection_id: "fixed-id",
    });

    expect(a.projection_version).toBe(TEXT_PROJECTION_VERSION);
    expect(a.content_hash.value).toBe(b.content_hash.value);
    expect(a.extractor).toEqual({ kind: "pdf-parse", version: "pdf-parse@1.0" });
    expect(a.extraction_status).toBe("partial");
    expect(a.ocr_used).toBe(false);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("records OCR path explicitly without mutating source bytes identity", () => {
    const sourceCopy = {
      ...source,
      ref: { ...source.ref },
      bytes_content_hash: { ...source.bytes_content_hash },
    };

    const projection = buildTextProjection({
      source: sourceCopy,
      text: "x".repeat(200),
      steps: [
        {
          method: "pdf_parse",
          version: "pdf-parse@1.0",
          char_count: 10,
          succeeded: true,
        },
        {
          method: "ocr_gemini",
          version: "gemini-2.5-flash",
          char_count: 200,
          succeeded: true,
        },
      ],
    });

    expect(projection.ocr_used).toBe(true);
    expect(projection.ocr).toEqual({
      kind: "ocr",
      version: "gemini-2.5-flash",
    });
    expect(projection.extractor.kind).toBe("pdf-parse");
    expect(projection.extraction_status).toBe("complete");
    // Source identity unchanged
    expect(sourceCopy.bytes_content_hash.value).toBe("aa".repeat(32));
    expect(sourceCopy.ref.artifact_id).toBe("doc-1");
    expect(projection.source_artifact_ref.artifact_id).toBe("doc-1");
    // Projection must not carry document_class
    expect("document_class" in projection).toBe(false);
    expect("evidence_doc_type" in projection).toBe(false);
  });
});
