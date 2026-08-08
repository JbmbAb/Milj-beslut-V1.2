import { describe, it, expect } from "vitest";
import {
  chunkTextStructure,
  routeToCorrectChunker,
  splitWithBoundary,
  TEXT_CHUNK_VERSION,
  verifyManifestsEqual,
} from "../src/index.js";

describe("text chunking v2.3 determinism", () => {
  const source = { artifact_id: "doc-law-1", artifact_type: "legal_document" };

  it("produces identical hashes and order on replay", () => {
    const text = `2 kap.\n6 § Verksamheten ska bedrivas så att olägenheter begränsas.\n\n7 § Tillsyn utövas av tillsynsmyndigheten.`;

    const a = chunkTextStructure({
      text,
      docName: "Miljöbalken",
      sourceSystem: "sfs",
      source_artifact_ref: source,
    });
    const b = chunkTextStructure({
      text,
      docName: "Miljöbalken",
      sourceSystem: "sfs",
      source_artifact_ref: source,
    });

    expect(a.chunks[0]?.chunk_version).toBe(TEXT_CHUNK_VERSION);
    expect(verifyManifestsEqual(a.manifest, b.manifest)).toEqual({ ok: true });
    expect(a.chunks.map((c) => c.content_hash.value)).toEqual(
      b.chunks.map((c) => c.content_hash.value),
    );
  });

  it("routeToCorrectChunker selects law for sfs", () => {
    const chunks = routeToCorrectChunker(
      "1 kap.\n1 § Syftet med denna balk.",
      "Miljöbalken",
      "sfs",
    );
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0]?.chapter).toBeDefined();
  });

  it("splitWithBoundary prefers whitespace over mid-word cuts", () => {
    const word = "abcdefghij";
    const text = Array.from({ length: 40 }, () => word).join(" ");
    const parts = splitWithBoundary(text, 80, 10);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) {
      // No part should start mid-word after first (leading space trimmed)
      expect(p.startsWith("bcdef")).toBe(false);
    }
  });

  it("boundary case -> no mid-word split, no unexpected paragraph break, stable overlap", () => {
    // Generate text that forces overlap and breaks
    const para1 = "Detta är första stycket. ".repeat(20);
    const para2 = "Här börjar det andra stycket. ".repeat(20);
    const text = para1.trim() + "\n\n" + para2.trim();
    
    // Set chunk size such that para1 can't fit in one chunk, but a break occurs in the middle
    const parts = splitWithBoundary(text, 100, 20);
    
    expect(parts.length).toBeGreaterThan(2);

    for (const p of parts) {
      // Ensure no part begins with a mid-word fragment
      expect(p.startsWith("etta")).toBe(false);
      expect(p.startsWith("rsta")).toBe(false);
      expect(p.startsWith("tycket")).toBe(false);
      
      expect(p.startsWith("\n")).toBe(false);
      expect(p.endsWith("\n")).toBe(false);
    }

    // Verify overlap is stable (second chunk shares text with first)
    if (parts.length > 1) {
      const first = parts[0];
      const second = parts[1];
      const lastWordsFirst = first!.split(" ").slice(-3).join(" ");
      expect(second).toContain(lastWordsFirst);
    }
  });
});
