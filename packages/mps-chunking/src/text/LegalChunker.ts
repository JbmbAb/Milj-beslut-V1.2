import { sanitizeForChunking } from "./sanitize.js";
import { MIN_CHUNK_CHARS, splitWithBoundary } from "./splitWithBoundary.js";

export interface PreparedLegalChunk {
  chunkText: string;
  chapter?: string;
  paragraph?: string;
  section?: string;
}

/**
 * Paragraph-aware chunker for Swedish law text (SFS, Miljöbalken, PBL).
 */
export function chunkSwedishLaw(text: string): PreparedLegalChunk[] {
  const sanitized = sanitizeForChunking(text);
  const chunks: PreparedLegalChunk[] = [];
  const chapterRegex = /(\d+)\s+kap\./i;

  const paragraphs = sanitized.split(/(?=\b\d+\s*[a-z]?\s*§)/i);
  let currentChapter = "1";

  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) continue;

    const chapMatch = trimmed.match(chapterRegex);
    if (chapMatch?.[1]) {
      currentChapter = chapMatch[1];
    }

    const paraNumMatch = trimmed.match(/^(\d+\s*[a-z]?)\s*§/i);
    const paraNum = paraNumMatch
      ? paraNumMatch[1]!.replace(/\s+/g, "").toLowerCase()
      : undefined;

    splitWithBoundary(trimmed).forEach((subText) => {
      chunks.push({
        chunkText: subText,
        chapter: currentChapter,
        paragraph: paraNum,
      });
    });
  }

  return chunks;
}

/**
 * LEGAL-CHUNKING-LAW-V2.4 — a new, separately versioned law chunker. Does NOT modify
 * `chunkSwedishLaw` (text/v2.3) in place; `chunk_policy_version` is identity-bearing
 * (LEGAL-CORPUS-MATERIALIZATION-IDENTITY-V2), so v2.3 and v2.4 materializations of the same raw
 * source are distinct, immutable rows -- v2.3's already-governed history is untouched by this.
 *
 * Three changes from v2.3:
 *
 *   1. Chapter detection now captures an optional single-letter suffix: "2 kap." -> "2",
 *      "2 a kap." -> "2 a", "10 a kap." -> "10 a" -- never truncated to the bare number.
 *
 *   2. A bounded, heuristic mitigation for the cross-reference boundary problem found in the
 *      real Miljöbalken pilot ("se 10 kap. 32 §" inside a paragraph's body being read as a new
 *      paragraph boundary). IMPORTANT LIMITATION, verified directly against the real projected
 *      text before writing this: TEXT-L1's HTML tag-stripping collapses ALL newlines (confirmed:
 *      0 newlines across 443,616 characters of the real Miljöbalken projection), so there is no
 *      positional signal (line start, paragraph break) left to distinguish a genuine heading
 *      from a reference embedded mid-sentence -- both look identical to a pure regex on this
 *      text. This is therefore a CONTENT heuristic (a short list of Swedish reference-indicator
 *      words immediately preceding a match), not a structural guarantee, and it will not catch
 *      every phrasing. A full fix belongs at the projection layer (preserving block/paragraph
 *      boundaries as newlines during HTML extraction), which is out of scope for this chunking
 *      unit and not done here.
 *
 *   3. LEGAL-CHUNKING-LAW-V2.4-CHAPTER-ANCHOR-01: `currentChapter` is only updated by a chapter
 *      marker judged structurally genuine -- never by one immediately preceded by a Swedish
 *      reference/list-continuation word (found via the real Miljöbalken text: "...omfattas av 10
 *      eller 10 a kap. sjölagen (1994:1009)..." is a cross-reference to a DIFFERENT statute's
 *      chapter, not a Miljöbalken chapter transition, and must never become one). Genuine chapter
 *      markers are also applied only going FORWARD, to fragments emitted after the marker is
 *      found -- never retroactively to the very fragment that contains the marker's trailing text
 *      (a real heading like "17 a kap. Har upphävts genom lag (2021:876)." sits at the END of the
 *      PRECEDING paragraph's fragment, because splitting only happens at "§" markers, never at
 *      "kap." headings -- so without this ordering, that fragment's own (earlier, different)
 *      paragraph content would be mislabeled with the chapter that starts only after it).
 */
// The split point falls immediately before a paragraph marker ("32 §"), which is normally
// preceded by "N kap. " (the chapter the reference names) -- so the reference word is typically
// NOT the last word before the split, "kap." is. Matches the whole "<reference word> N[ x] kap."
// phrase immediately before the split, or a bare ", N[ x] kap." / "och N[ x] kap." continuing a
// comma-separated list of references (the real Miljöbalken pattern: "7 kap. 32 §, 10 kap. 18 a §
// och 15 kap. 40 §").
const REFERENCE_WORD_LOOKBEHIND = new RegExp(
  '(?:' +
    '\\b(se|jfr|enligt|framgår av|anges i|föreskrivs i|i|eller)\\s+\\d+(?:\\s+[a-z])?\\s+kap\\.' +
    '|,\\s*\\d+(?:\\s+[a-z])?\\s+kap\\.' +
    '|\\boch\\s+\\d+(?:\\s+[a-z])?\\s+kap\\.' +
  ')\\s*$',
  'i',
);

function isReferenceWordPreceded(text: string, matchIndex: number): boolean {
  const windowStart = Math.max(0, matchIndex - 50);
  const before = text.slice(windowStart, matchIndex).trimEnd();
  return REFERENCE_WORD_LOOKBEHIND.test(before);
}

function isLikelyCrossReference(text: string, matchIndex: number): boolean {
  return isReferenceWordPreceded(text, matchIndex);
}

// LEGAL-CHUNKING-LAW-V2.4-CHAPTER-ANCHOR-01: finds the last chapter marker in `text` that is NOT
// immediately preceded by a reference/list-continuation word (see REFERENCE_WORD_LOOKBEHIND) --
// i.e. the last one that is structurally plausible as a genuine chapter transition rather than a
// cross-reference embedded mid-sentence. "Last" because a fragment's trailing text can contain a
// chain of consecutive headings (e.g. a repealed chapter immediately followed by the next real
// one -- "17 a kap. Har upphävts genom lag (2021:876). 18 kap. Regeringens prövning...") and only
// the final one in that chain is the chapter that actually applies to whatever comes next.
const CHAPTER_MARKER = /(\d+(?:\s+[a-z])?)\s+kap\./gi;

function findGenuineChapterUpdate(text: string): string | undefined {
  let genuine: string | undefined;
  for (const match of text.matchAll(CHAPTER_MARKER)) {
    if (isReferenceWordPreceded(text, match.index)) continue;
    genuine = match[1]!.replace(/\s+/g, " ").trim();
  }
  return genuine;
}

/**
 * Document-level check, for callers (e.g. chunk admission) that need to know whether ANY
 * structurally genuine chapter marker exists anywhere in the raw text -- using the same
 * reference-word filtering as `chunkSwedishLawV24` itself, so a document containing ONLY a
 * cross-reference to another statute's chapter (and no real Miljöbalken heading) is correctly
 * reported as having no verified chapter division.
 */
export function hasGenuineChapterMarkerV24(text: string): boolean {
  const sanitized = sanitizeForChunking(text);
  return findGenuineChapterUpdate(sanitized) !== undefined;
}

export function chunkSwedishLawV24(text: string): PreparedLegalChunk[] {
  const sanitized = sanitizeForChunking(text);
  const chunks: PreparedLegalChunk[] = [];
  const paragraphSplit = /(?=\b\d+\s*[a-z]?\s*§)/i;

  const rawParagraphs = sanitized.split(paragraphSplit);
  // Re-merge any split point that isLikelyCrossReference judges as a reference, not a boundary,
  // so the cross-reference text stays attached to the paragraph it actually belongs to instead
  // of becoming its own spurious fragment.
  const paragraphs: string[] = [];
  let cursor = 0;
  for (let i = 0; i < rawParagraphs.length; i++) {
    const para = rawParagraphs[i];
    const paraStartInSanitized = cursor;
    cursor += para.length;
    if (i === 0) {
      paragraphs.push(para);
      continue;
    }
    if (isLikelyCrossReference(sanitized, paraStartInSanitized)) {
      paragraphs[paragraphs.length - 1] += para;
    } else {
      paragraphs.push(para);
    }
  }

  let currentChapter = "1";

  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) continue;

    const paraNumMatch = trimmed.match(/^(\d+\s*[a-z]?)\s*§/i);
    const paraNum = paraNumMatch
      ? paraNumMatch[1]!.replace(/\s+/g, "").toLowerCase()
      : undefined;

    // Emit this fragment's own chunks under the chapter established BEFORE it -- a genuine
    // heading trailing at this fragment's own end describes the NEXT chapter, not this one.
    splitWithBoundary(trimmed).forEach((subText) => {
      chunks.push({
        chunkText: subText,
        chapter: currentChapter,
        paragraph: paraNum,
      });
    });

    const genuineUpdate = findGenuineChapterUpdate(trimmed);
    if (genuineUpdate) currentChapter = genuineUpdate;
  }

  return chunks;
}

/**
 * Two-step chunker for court decisions: sections → paragraphs → boundary split.
 */
export function chunkCourtDecision(text: string): PreparedLegalChunk[] {
  const sanitized = sanitizeForChunking(text);
  const sections = sanitized.split(
    /(?=\b(?:DOMSLUT|DOMSK[ÄA]L|YRKANDEN|BAKGRUND|SK[ÄA]L)\b)/g,
  );
  const chunks: PreparedLegalChunk[] = [];

  sections.forEach((sec) => {
    const trimmedSec = sec.trim();
    if (!trimmedSec) return;

    const sectionMatch = trimmedSec.match(
      /^(DOMSLUT|DOMSK[ÄA]L|YRKANDEN|BAKGRUND|SK[ÄA]L)/i,
    );
    const sectionType = sectionMatch
      ? sectionMatch[1]!
          .toUpperCase()
          .replace("DOMSKÁL", "DOMSKÄL")
          .replace("SKÁL", "SKÄL")
      : "ÖVRIGT";

    const paragraphs = trimmedSec.split(/\n\s*\n/);
    paragraphs.forEach((p) => {
      const trimmedPara = p.trim();
      if (trimmedPara.length < MIN_CHUNK_CHARS) return;

      splitWithBoundary(trimmedPara).forEach((subText) => {
        chunks.push({
          chunkText: subText,
          section: sectionType,
        });
      });
    });
  });

  return chunks;
}

/**
 * Standard fallback: paragraphs + boundary-aware overlap split.
 */
export function chunkStandard(text: string): PreparedLegalChunk[] {
  const sanitized = sanitizeForChunking(text);
  const paragraphs = sanitized.split(/\n\s*\n/);
  const chunks: PreparedLegalChunk[] = [];

  paragraphs.forEach((p) => {
    const trimmed = p.trim();
    if (trimmed.length < MIN_CHUNK_CHARS) return;

    splitWithBoundary(trimmed).forEach((subText) => {
      chunks.push({ chunkText: subText });
    });
  });

  return chunks;
}
