/**
 * server/modules/legal/services/semanticChunker.ts
 *
 * Juridisk textchunker för RAG-pipeline.
 *
 * Principer:
 * - Använder repairMojibake() från textEncoding.ts (aldrig normalizeExternalText
 *   som kollapsar radbrytningar och förstör \n\n-baserad chunking för domar).
 * - Lagar chunkas per paragraf (§), med kapitelskontext.
 * - Domar chunkas tvåstegsvis: sektioner (DOMSKÄL etc.) → stycken (\n\n).
 * - Chunk-storlek begränsas till MAX_CHUNK_CHARS med OVERLAP_CHARS överlapp
 *   för konsekventa embeddings.
 * - routeToCorrectChunker() väljer automatiskt chunker via sourceSystem.
 */

import { repairMojibake } from '../../../utils/textEncoding';

/** Max ~300 ord per chunk för optimala embeddings */
const MAX_CHUNK_CHARS = 1500;
/** ~15% överlapp för att bevara kontext vid delning */
const OVERLAP_CHARS = 225;
/** Minimum tecken för att en chunk ska sparas (brus-filter) */
const MIN_CHUNK_CHARS = 20;

export interface PreparedLegalChunk {
  chunkText: string;
  chapter?: string;
  paragraph?: string;
  section?: string;
}

// ─── Intern hjälpfunktion ──────────────────────────────────────────────────

/**
 * Sanerar text för chunking: reparerar mojibake och normaliserar
 * horisontell luft/radbrytningar – men bevarar \n\n (styckeindelningar).
 */
function sanitizeForChunking(text: string): string {
  return repairMojibake(text)
    .replace(/[ \t]+/g, ' ')     // Kollapsa horisontell luft (ej radbrytningar)
    .replace(/\n{3,}/g, '\n\n'); // Max ett tomt stycke
}

/**
 * Delar upp ett långt textblock i mindre delar med överlapp.
 */
function splitWithOverlap(
  text: string,
  limit = MAX_CHUNK_CHARS,
  overlap = OVERLAP_CHARS,
): string[] {
  if (text.length <= limit) return [text];

  const parts: string[] = [];
  let start = 0;

  while (start < text.length) {
    const end = Math.min(text.length, start + limit);
    parts.push(text.slice(start, end).trim());
    if (end >= text.length) break;
    start = end - overlap;
  }

  return parts.filter((p) => p.length >= MIN_CHUNK_CHARS);
}

// ─── Chunkers ─────────────────────────────────────────────────────────────

/**
 * Paragrafchunker för svensk lagtext (SFS, Miljöbalken, PBL m.fl.).
 * Delar upp texten precis innan varje paragraf-symbol (§)
 * och håller kapitelkontext uppdaterad.
 */
export function chunkSwedishLaw(text: string): PreparedLegalChunk[] {
  const sanitized = sanitizeForChunking(text);
  const chunks: PreparedLegalChunk[] = [];
  const chapterRegex = /(\d+)\s+kap\./i;

  // Splitta PRECIS innan paragraf: "6 §", "6 a §", "12 b §"
  const paragraphs = sanitized.split(/(?=\b\d+\s*[a-z]?\s*§)/i);
  let currentChapter = '1';

  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) continue;

    // Uppdatera kapitel om rubriken finns i denna chunk
    const chapMatch = trimmed.match(chapterRegex);
    if (chapMatch && chapMatch[1]) {
      currentChapter = chapMatch[1];
    }

    // Extrahera paragrafnummer (kanonisk form: "6", "6a", "12b")
    const paraNumMatch = trimmed.match(/^(\d+\s*[a-z]?)\s*§/i);
    const paraNum = paraNumMatch
      ? paraNumMatch[1].replace(/\s+/g, '').toLowerCase()
      : undefined;

    // Adaptiv delning vid mycket långa paragrafer
    splitWithOverlap(trimmed).forEach((subText) => {
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
 * Tvåstegschunker för domar och beslut.
 *
 * Steg 1: Dela på nyckelrubriker (DOMSLUT, DOMSKÄL, YRKANDEN, BAKGRUND, SKÄL).
 * Steg 2: Dela varje sektion på stycken (\n\n).
 * Steg 3: Adaptiv delning vid för långa stycken.
 *
 * Sektionsnamnet sparas i `section`-fältet för metadatafiltrering.
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

    // Plocka ut sektionsnamnet
    const sectionMatch = trimmedSec.match(
      /^(DOMSLUT|DOMSK[ÄA]L|YRKANDEN|BAKGRUND|SK[ÄA]L)/i,
    );
    const sectionType = sectionMatch
      ? sectionMatch[1].toUpperCase().replace('DOMSKÁL', 'DOMSKÄL').replace('SKÁL', 'SKÄL')
      : 'ÖVRIGT';

    // Steg 2: Dela på stycken
    const paragraphs = trimmedSec.split(/\n\s*\n/);

    paragraphs.forEach((p) => {
      const trimmedPara = p.trim();
      if (trimmedPara.length < MIN_CHUNK_CHARS) return;

      // Steg 3: Adaptiv delning
      splitWithOverlap(trimmedPara).forEach((subText) => {
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
 * Standard fallback-chunker för vanliga PDF:er och beslutsdokument.
 * Delar på stycken med adaptiv gränsstorlek.
 */
export function chunkStandard(text: string): PreparedLegalChunk[] {
  const sanitized = sanitizeForChunking(text);
  const paragraphs = sanitized.split(/\n\s*\n/);
  const chunks: PreparedLegalChunk[] = [];

  paragraphs.forEach((p) => {
    const trimmed = p.trim();
    if (trimmed.length < MIN_CHUNK_CHARS) return;

    splitWithOverlap(trimmed).forEach((subText) => {
      chunks.push({ chunkText: subText });
    });
  });

  return chunks;
}

/**
 * Automatisk routing till rätt chunker baserat på manifest-metadata.
 *
 * Prioritetsordning:
 * 1. sourceSystem matchar 'sfs' eller 'riksdagen' → lag
 * 2. sourceSystem matchar 'domstol', 'möd', 'mmd' → dom
 * 3. docName innehåller kända lagnyckelord → lag
 * 4. Fallback → standard
 */
export function routeToCorrectChunker(
  rawText: string,
  docName: string,
  sourceSystem?: string,
): PreparedLegalChunk[] {
  const src = String(sourceSystem || '').toLowerCase();
  const name = docName.toLowerCase();

  if (
    src.includes('sfs') ||
    src.includes('riksdagen') ||
    src.includes('lagrummet') ||
    name.includes('miljöbalken') ||
    name.includes('plan- och bygglagen') ||
    name.includes('pbl ')
  ) {
    return chunkSwedishLaw(rawText);
  }

  if (
    src.includes('domstol') ||
    src.includes('möd') ||
    src.includes('mmd') ||
    src.includes('mark- och miljö') ||
    name.includes(' dom ') ||
    name.includes('mö') ||
    name.startsWith('m ')
  ) {
    return chunkCourtDecision(rawText);
  }

  return chunkStandard(rawText);
}
