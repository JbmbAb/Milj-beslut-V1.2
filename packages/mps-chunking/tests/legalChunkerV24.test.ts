import { describe, expect, it } from "vitest";
import { chunkSwedishLaw, chunkSwedishLawV24 } from "../src/text/LegalChunker.js";

/**
 * LEGAL-CHUNKING-LAW-V2.4.
 *
 * A new, separately versioned chunker -- chunkSwedishLaw (text/v2.3) is asserted unchanged
 * below, not just left alone by convention.
 */
describe("LEGAL-CHUNKING-LAW-V2.4 — letter-suffixed chapter support", () => {
  const cases: Array<[string, string]> = [
    ["2 kap.", "2"],
    ["2 a kap.", "2 a"],
    ["2 b kap.", "2 b"],
    ["10 kap.", "10"],
    ["10 a kap.", "10 a"],
  ];

  for (const [heading, expectedChapter] of cases) {
    it(`"${heading}" -> chapter "${expectedChapter}"`, () => {
      const text = `${heading} Rubrik.\n1 § Text för första paragrafen, tillräckligt lång för att räknas.`;
      const chunks = chunkSwedishLawV24(text);
      const withParagraph = chunks.find((c) => c.paragraph === "1");
      expect(withParagraph?.chapter).toBe(expectedChapter);
    });
  }

  it("v2.3 (chunkSwedishLaw) is unchanged: still does NOT capture the letter suffix", () => {
    const text = "2 a kap. 5 § Text för paragrafen, tillräckligt lång för att räknas som en egen chunk.";
    const v23 = chunkSwedishLaw(text);
    // v2.3's chapterRegex (\d+)\s+kap\. does not match "2 a kap." at all (the letter breaks the
    // \s+kap\. adjacency), so chapter stays at its unset default "1" for every fragment.
    expect(v23.every((c) => c.chapter === "1")).toBe(true);
  });
});

describe("LEGAL-CHUNKING-LAW-V2.4 — cross-reference boundary mitigation", () => {
  it("does not treat 'se 10 kap. 32 §' as a new chapter/paragraph boundary", () => {
    const text =
      "1 § Bestämmelserna gäller enligt vad som anges nedan, se 10 kap. 32 § för undantag, " +
      "och detta stycke fortsätter med ytterligare text som hör till paragraf ett.";
    const chunks = chunkSwedishLawV24(text);
    // The cross-reference must not have produced its own fragment carrying chapter "10"/paragraph "32".
    expect(chunks.some((c) => c.chapter === "10" && c.paragraph === "32")).toBe(false);
  });

  it("does not treat 'enligt 2 a kap. 4 §' as a new chapter/paragraph boundary", () => {
    const text =
      "1 § Bestämmelserna i detta stycke gäller enligt 2 a kap. 4 § i tillämpliga delar, " +
      "och paragrafen fortsätter med ytterligare text av tillräcklig längd.";
    const chunks = chunkSwedishLawV24(text);
    expect(chunks.some((c) => c.chapter === "2 a" && c.paragraph === "4")).toBe(false);
  });

  it("REAL CASE from the Miljöbalken pilot: a comma-separated list of cross-references does not fragment the paragraph", () => {
    const text =
      "2 § Ytterligare bestämmelser om balkens tillämpning utanför territorialgränsen finns i " +
      "7 kap. 32 §, 10 kap. 18 a § och 15 kap. 40 § samt i annan lagstiftning enligt vad som föreskrivs.";
    const chunks = chunkSwedishLawV24(text);
    // All of this belongs to paragraph 2 -- none of the three embedded references should have
    // spawned their own chapter/paragraph-labeled fragment.
    expect(chunks.some((c) => c.chapter === "10" && c.paragraph === "18a")).toBe(false);
    expect(chunks.some((c) => c.chapter === "15" && c.paragraph === "40")).toBe(false);
    expect(chunks.length).toBeGreaterThan(0);
  });

  it("KNOWN LIMITATION (documented, not silently claimed fixed): a cross-reference not preceded by a recognized reference word can still be misread as a boundary, because TEXT-L1 projection preserves no newlines to disambiguate position", () => {
    // No "se"/"enligt"/"i" immediately before the reference -- outside this heuristic's coverage.
    const text =
      "1 § Text för första paragrafen. 10 kap. 32 § innehåller undantag som också gäller här " +
      "och detta stycke fortsätter med ytterligare text av tillräcklig längd för en chunk.";
    const chunks = chunkSwedishLawV24(text);
    // This assertion documents the current, known boundary of the heuristic's coverage -- it is
    // NOT a requirement that this specific phrasing must be misread, only an honest record that
    // the heuristic does not claim to catch every phrasing (see the module-level doc comment).
    const misreadAsBoundary = chunks.some((c) => c.chapter === "10" && c.paragraph === "32");
    expect(typeof misreadAsBoundary).toBe("boolean");
  });

  it("a genuine chapter heading (not preceded by a reference word) is still detected normally", () => {
    const text = "10 a kap. Särskilda bestämmelser.\n1 § Text för paragrafen, tillräckligt lång för en chunk.";
    const chunks = chunkSwedishLawV24(text);
    const withParagraph = chunks.find((c) => c.paragraph === "1");
    expect(withParagraph?.chapter).toBe("10 a");
  });
});

/**
 * LEGAL-CHUNKING-LAW-V2.4-CHAPTER-ANCHOR-01.
 *
 * Closes a real structural drift found via LEGAL-CORPUS-LAW-V2.4-REMATERIALIZATION-01: the real
 * Miljöbalken text contains "...omfattas av 10 eller 10 a kap. sjölagen (1994:1009)..." -- a
 * cross-reference to a DIFFERENT statute's chapter, not a Miljöbalken chapter transition -- which
 * chapMatch's free (unanchored) search across a fragment's full text was picking up as if it were
 * a real chapter boundary.
 */
describe("LEGAL-CHUNKING-LAW-V2.4-CHAPTER-ANCHOR-01 — chapter transitions only at structurally genuine positions", () => {
  it("REAL CASE (the exact Miljöbalken sentence that revealed the bug): a cross-reference to a different statute's chapter ('10 eller 10 a kap. sjölagen') does not become a Miljöbalken chapter transition", () => {
    const text =
      "10 § Text i det aktuella kapitlet, med tillräckligt lång text för att räknas som en chunk. " +
      "11 § Detta kapitel gäller inte miljöskador som 1. omfattas av 10 eller 10 a kap. sjölagen " +
      "(1994:1009), 2. omfattas av lagen (2005:253) om ersättning, med tillräckligt lång text här.";
    const chunks = chunkSwedishLawV24(text);
    // No chunk anywhere should carry chapter "10 a" -- there is no genuine Miljöbalken heading in
    // this text at all (only the cross-reference), so chapter must stay at whatever it already was.
    expect(chunks.some((c) => c.chapter === "10 a")).toBe(false);
  });

  it("REAL CASE: a genuine repealed-chapter heading ('17 a kap. Har upphävts...') immediately followed by the next real heading ('18 kap.') in the same fragment tail correctly hands chapter context to the NEXT real chapter, not retroactively to the paragraph whose trailing text contains the headings", () => {
    const text =
      "8 § Om det finns särskilda skäl får länsstyrelsen tillåta en mindre avvikelse från ett " +
      "tillåtlighetsbeslut som gäller en väg eller järnväg, med tillräckligt lång text för en chunk. " +
      "Lag (2012:441). 17 a kap. Har upphävts genom lag (2021:876). " +
      "18 kap. Regeringens prövning av överklagade avgöranden m.m.\n" +
      "1 § Regeringen prövar efter överklagande, med tillräckligt lång text för att bli en egen chunk.";
    const chunks = chunkSwedishLawV24(text);

    const paragraph8 = chunks.find((c) => c.paragraph === "8");
    const paragraph1 = chunks.find((c) => c.paragraph === "1");
    // Paragraph 8's own content must NOT be relabeled with a chapter that only starts after it.
    expect(paragraph8?.chapter).not.toBe("17 a");
    expect(paragraph8?.chapter).not.toBe("18");
    // The chapter heading trailing at the end of paragraph 8's fragment correctly applies going
    // forward: paragraph 1 (the next real content) is in chapter 18, not the repealed 17 a.
    expect(paragraph1?.chapter).toBe("18");
  });

  it("does not regress the already-proven cross-reference boundary mitigation cases", () => {
    const seCase = chunkSwedishLawV24(
      "1 § Bestämmelserna gäller enligt vad som anges nedan, se 10 kap. 32 § för undantag, " +
      "och detta stycke fortsätter med ytterligare text som hör till paragraf ett.",
    );
    expect(seCase.some((c) => c.chapter === "10" && c.paragraph === "32")).toBe(false);

    const enligtCase = chunkSwedishLawV24(
      "1 § Bestämmelserna i detta stycke gäller enligt 2 a kap. 4 § i tillämpliga delar, " +
      "och paragrafen fortsätter med ytterligare text av tillräcklig längd.",
    );
    expect(enligtCase.some((c) => c.chapter === "2 a" && c.paragraph === "4")).toBe(false);
  });

  it("still recognizes genuine plain and letter-suffixed headings ('2 kap.', '2 a kap.', '10 kap.', '17 a kap.') at structurally valid positions", () => {
    for (const [heading, expected] of [
      ["2 kap.", "2"],
      ["2 a kap.", "2 a"],
      ["10 kap.", "10"],
      ["17 a kap.", "17 a"],
    ] as const) {
      const text = `${heading} Rubrik.\n1 § Text för första paragrafen, tillräckligt lång för att räknas.`;
      const chunks = chunkSwedishLawV24(text);
      const withParagraph = chunks.find((c) => c.paragraph === "1");
      expect(withParagraph?.chapter).toBe(expected);
    }
  });
});
