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
