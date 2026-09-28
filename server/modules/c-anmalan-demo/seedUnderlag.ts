/**
 * Declared seed loader (charter §0f / K-36, K-51). The case itself (property, codes, quantities,
 * names) is never a literal in the demo code: it is read from DEMO_UNDERLAG_DIR through
 * underlagLoader.ts, quoted verbatim with file + sha256. There is no default folder (K-51):
 * without DEMO_UNDERLAG_DIR the loader refuses to run.
 *
 *   DEMO_UNDERLAG_DIR      folder with the user's underlag files (required)
 *   DEMO_UNDERLAG_MAPPING  mapping of input fields to verbatim excerpts (kept outside the repo)
 */
import fs from 'node:fs';
import { putBlob } from './caseStore';
import { loadUnderlag, type UnderlagMapping } from './underlagLoader';

export const DEFAULT_UNDERLAG_MAPPING = 'C:\\miljöbeslut\\Claude outputs\\demo-01-writer\\underlag\\mapping.json';

export function underlagDir(): string {
  const dir = process.env.DEMO_UNDERLAG_DIR?.trim();
  if (!dir) {
    throw new Error(
      'DEMO_UNDERLAG_DIR saknas: ange mappen med användarens underlag (underlagsfilerna och SHA256SUMS.txt). ' +
        'Seed-inläsaren har ingen standardmapp (K-51).',
    );
  }
  if (!fs.existsSync(dir)) throw new Error(`DEMO_UNDERLAG_DIR finns inte: ${dir}`);
  return dir;
}

export function underlagMappingPath(): string {
  return process.env.DEMO_UNDERLAG_MAPPING || DEFAULT_UNDERLAG_MAPPING;
}

export function seedFromUnderlag() {
  const dir = underlagDir();
  const mapping = JSON.parse(fs.readFileSync(underlagMappingPath(), 'utf8')) as UnderlagMapping;
  const loaded = loadUnderlag(dir, mapping);
  // Attachments are copied into the content-addressed store; PDFs read them back by hash only.
  for (const a of loaded.underlag.attachments ?? []) putBlob(loaded.attachmentBytes.get(a.sha256)!, a.mime);
  return { dir, input: loaded.input, underlag: loaded.underlag };
}
