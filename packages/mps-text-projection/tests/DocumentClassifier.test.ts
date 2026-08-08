import { describe, it, expect } from "vitest";
import { buildTextProjection, classifyDocument } from "../src/index.js";

describe("DocumentClassification after TextProjection", () => {
  it("classifies SFS as law via hints + projection labels", () => {
    const projection = buildTextProjection({
      source: {
        ref: { artifact_id: "law-1" },
        doc_name: "Miljöbalken",
        source_system: "sfs",
      },
      text: "1 kap.\n1 § Syftet med denna balk är att.",
      steps: [
        {
          method: "preextracted",
          version: "test",
          char_count: 40,
          succeeded: true,
        },
      ],
    });

    const c = classifyDocument(projection);
    expect(c.document_class).toBe("law");
    expect(c.chunk_kind).toBe("law");
    expect(c.confidence).toBe("high");
  });

  it("honours evidence_doc_type from ClassificationHints (not on projection)", () => {
    const projection = buildTextProjection({
      source: {
        ref: { artifact_id: "ev-1" },
        doc_name: "beslut.pdf",
      },
      text: "2. VILLKOR OCH FÖRSIKTIGHETSMÅTT\nBullervillkor.",
      steps: [
        {
          method: "preextracted",
          version: "test",
          char_count: 50,
          succeeded: true,
        },
      ],
    });

    expect("evidence_doc_type" in projection).toBe(false);

    const c = classifyDocument(projection, { evidence_doc_type: "decision" });
    expect(c.document_class).toBe("evidence_decision");
    expect(c.chunk_kind).toBe("evidence");
    expect(c.evidence_doc_type).toBe("decision");
  });
});
