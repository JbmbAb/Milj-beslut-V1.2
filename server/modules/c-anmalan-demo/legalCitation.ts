/**
 * MPF citation for DEMO-01 (K-25, K-26 §4): retrieval only, no interpretation.
 *
 * The user picks the verksamhetskod; this module only looks up the paragraph in the locally
 * seeded legal corpus and quotes it verbatim (line wraps joined), with record_key,
 * content_hash and the J-3 caveat. It never decides which code applies.
 */
import { prisma } from '../../../db.server';

export const MPF_RECORD_KEY = 'foundation:sfs-2013-251';

export interface MpfCitation {
  code: string;
  found: boolean;
  paragraph?: string;
  /** "Anmälningsplikt C" / "Tillståndsplikt B", read from the paragraph's own first words. */
  provningsniva?: string;
  text?: string;
  recordKey: string;
  contentHash: string | null;
  caveat: string;
}

export function j3Caveat(fetchedDate: string | null): string {
  return `korpus hämtad ${fetchedDate ?? 'okänt datum'}, giltighetsdatum ej bundet (J-3)`;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const PARAGRAPH_START = /^\d+\s?[a-z]?\s§\s/;

/**
 * Pure extractor. Blocks are separated by blank lines; the paragraph is the block that starts
 * with "<n> §" and names exactly this code, plus following blocks until the next paragraph or a
 * heading (a single short line without final punctuation).
 */
export function extractMpfParagraph(documentText: string, code: string): { paragraph: string; provningsniva: string | null; text: string } | null {
  const blocks = documentText.replace(/\r\n/g, '\n').split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  const codeRe = new RegExp(`verksamhetskod\\s+${escapeRe(code)}(?![\\d.-])`);
  const startIdx = blocks.findIndex((b) => PARAGRAPH_START.test(b) && codeRe.test(b.replace(/\s*\n\s*/g, ' ')));
  if (startIdx < 0) return null;
  const out = [blocks[startIdx]];
  for (let i = startIdx + 1; i < blocks.length; i += 1) {
    const b = blocks[i];
    // Heading: one short line, no final punctuation, not a list item or a continued sentence.
    const isHeading =
      !b.includes('\n') && b.length < 80 && !/[.,:;)]$/.test(b) && !/^\d+\.\s/.test(b) && !/\b(eller|och|samt)$/.test(b);
    if (PARAGRAPH_START.test(b) || isHeading) break;
    out.push(b);
  }
  const text = out.map((b) => b.replace(/\s*\n\s*/g, ' ')).join('\n');
  const paragraph = (blocks[startIdx].match(/^(\d+\s?[a-z]?)\s§/) ?? [])[1] ?? '?';
  let chapter: string | null = null;
  for (let i = startIdx - 1; i >= 0 && !chapter; i -= 1) {
    chapter = (blocks[i].match(/^(\d+) kap\.\s/) ?? [])[1] ?? null;
  }
  const niva = text.match(/(Tillståndsplikt|Anmälningsplikt)\s+([ABC])/);
  return {
    paragraph: `${chapter ? `${chapter} kap. ` : ''}${paragraph} § MPF`,
    provningsniva: niva ? `${niva[1]} ${niva[2]}` : null,
    text,
  };
}

export async function citeMpfCodes(codes: string[]): Promise<MpfCitation[]> {
  const rows = await prisma.$queryRaw<Array<{ document_text: string; content_hash: string | null; created: string | null }>>`
    SELECT document_text, content_hash, to_char(created_at, 'YYYY-MM-DD') AS created
    FROM legal_corpus_records WHERE record_key = ${MPF_RECORD_KEY} LIMIT 1`;
  const rec = rows[0];
  const caveat = j3Caveat(rec?.created ?? null);
  return codes.map((code) => {
    const hit = rec ? extractMpfParagraph(rec.document_text, code) : null;
    return {
      code,
      found: Boolean(hit),
      paragraph: hit?.paragraph,
      provningsniva: hit?.provningsniva ?? undefined,
      text: hit?.text,
      recordKey: MPF_RECORD_KEY,
      contentHash: rec?.content_hash ?? null,
      caveat,
    };
  });
}
