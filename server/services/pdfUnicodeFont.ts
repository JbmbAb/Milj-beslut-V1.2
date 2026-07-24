/**
 * Resolve a Unicode-capable TTF for PDFKit so Swedish letters (åäö) render.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

function repoFontCandidates(): string[] {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const root = path.resolve(here, '../..');
    return [
      path.join(root, 'assets', 'fonts', 'DejaVuSans.ttf'),
      path.join(root, 'assets', 'fonts', 'NotoSans-Regular.ttf'),
    ];
  } catch {
    return [];
  }
}

const CANDIDATES = [
  process.env.PDF_UNICODE_FONT_PATH,
  ...repoFontCandidates(),
  'C:\\Windows\\Fonts\\arial.ttf',
  'C:\\Windows\\Fonts\\segoeui.ttf',
  'C:\\Windows\\Fonts\\calibri.ttf',
  'C:\\Windows\\Fonts\\cour.ttf',
  path.join(os.homedir(), 'AppData', 'Local', 'Microsoft', 'Windows', 'Fonts', 'arial.ttf'),
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
  '/System/Library/Fonts/Supplemental/Arial.ttf',
].filter(Boolean) as string[];

let cachedPath: string | null | undefined;

function looksLikeTrueType(filePath: string): boolean {
  try {
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(4);
    fs.readSync(fd, buf, 0, 4, 0);
    fs.closeSync(fd);
    const asInt = buf.readUInt32BE(0);
    const asStr = buf.toString('ascii');
    return asInt === 0x00010000 || asStr === 'true' || asStr === 'OTTO' || asStr === 'ttcf';
  } catch {
    return false;
  }
}

/** Absolute path to a TTF that supports Swedish glyphs, or null. */
export function resolveUnicodeFontPath(): string | null {
  if (cachedPath !== undefined) return cachedPath;
  for (const candidate of CANDIDATES) {
    try {
      if (candidate && fs.existsSync(candidate) && looksLikeTrueType(candidate)) {
        cachedPath = candidate;
        return cachedPath;
      }
    } catch {
      // continue
    }
  }
  cachedPath = null;
  return null;
}

/** Reset cache (tests). */
export function resetUnicodeFontCache(): void {
  cachedPath = undefined;
}

/**
 * Register and select Unicode font on a PDFKit document.
 * Tries each candidate until one registers successfully.
 */
export function applyUnicodeFont(doc: {
  registerFont: (name: string, path: string) => unknown;
  font: (name: string) => unknown;
}): string | null {
  const preferred = resolveUnicodeFontPath();
  const ordered = preferred
    ? [preferred, ...CANDIDATES.filter((c) => c && c !== preferred)]
    : CANDIDATES;

  const name = 'MBUnicode';
  for (const fontPath of ordered) {
    if (!fontPath || !fs.existsSync(fontPath) || !looksLikeTrueType(fontPath)) continue;
    try {
      doc.registerFont(name, fontPath);
      doc.font(name);
      cachedPath = fontPath;
      return name;
    } catch {
      // try next candidate
    }
  }
  return null;
}
