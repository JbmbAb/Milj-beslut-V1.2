import { describe, expect, it } from "vitest";
import { buildTextProjection, isOcrExtractionMethod, methodToExtractorKind } from "../src/index.js";

describe("ocr_tesseract provenance", () => {
  it("maps local tesseract onto the existing ocr extractor kind", () => {
    expect(methodToExtractorKind("ocr_tesseract")).toBe("ocr");
    expect(isOcrExtractionMethod("ocr_tesseract")).toBe(true);
    expect(isOcrExtractionMethod("pdf_parse")).toBe(false);
  });

  it("records tesseract as OCR and keeps a successful pdf-parse step primary", () => {
    const projection = buildTextProjection({
      source: { ref: { artifact_id: "scan" }, doc_name: "scan.pdf" },
      text: "Detta är den OCR-text som projiceras vidare till TextProjection.",
      steps: [
        {
          method: "pdf_parse",
          version: "pdf-parse@2.4.5",
          char_count: 4,
          succeeded: true,
        },
        {
          method: "ocr_tesseract",
          version: "tesseract@5.4.0.20240606;langs=swe+eng",
          char_count: 64,
          succeeded: true,
        },
      ],
    });

    expect(projection.extractor.kind).toBe("pdf-parse");
    expect(projection.ocr_used).toBe(true);
    expect(projection.ocr?.kind).toBe("ocr");
    expect(projection.ocr?.version).toContain("tesseract@5.4.0.20240606");
    expect(projection.ocr?.version).toContain("langs=swe+eng");
    expect(projection.contract_id).toBe("text_projection");
  });

  it("uses tesseract identity as the extractor when OCR is the only successful step", () => {
    const projection = buildTextProjection({
      source: { ref: { artifact_id: "scan-2" }, doc_name: "scan.pdf" },
      text: "endast ocr text som är lång nog för en fullständig projektion här",
      steps: [
        {
          method: "pdf_parse",
          version: "pdf-parse@2.4.5",
          char_count: 0,
          succeeded: false,
        },
        {
          method: "ocr_tesseract",
          version: "tesseract@5.4.0.20240606;langs=swe",
          char_count: 68,
          succeeded: true,
        },
      ],
    });

    expect(projection.extractor.kind).toBe("ocr");
    expect(projection.extractor.version).toContain("tesseract@");
    expect(projection.ocr_used).toBe(true);
  });
});
