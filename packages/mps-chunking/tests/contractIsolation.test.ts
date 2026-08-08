import { describe, it, expect } from "vitest";
import {
  chunkArchiveBytes,
  chunkTextStructure,
  formatContractVersion,
} from "../src/index.js";

describe("contract isolation", () => {
  it("keeps separate version namespaces", () => {
    expect(formatContractVersion("text")).toBe("text/v2.3");
    expect(formatContractVersion("archive")).toBe("archive/v1.0");
  });

  it("archive chunker rejects non-Uint8Array", () => {
    expect(() =>
      chunkArchiveBytes("not-bytes" as unknown as Uint8Array, {
        artifact_id: "x",
      }),
    ).toThrow(/REJECT_ARCHIVE_CONTRACT/);
  });

  it("text chunker rejects non-string text", () => {
    expect(() =>
      chunkTextStructure({
        text: Buffer.from("x") as unknown as string,
        docName: "doc",
        source_artifact_ref: { artifact_id: "x" },
      }),
    ).toThrow(/REJECT_TEXT_CONTRACT/);
  });

  it("archive API has no overlap parameter on chunkArchiveBytes", () => {
    // Structural: function length is (bytes, source, maxChunkBytes?) — no overlap
    expect(chunkArchiveBytes.length).toBeLessThanOrEqual(3);
  });
});
