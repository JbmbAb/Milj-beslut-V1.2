/**
 * Declared seed loader (charter §0f / K-36): the ONLY demo-path file that may name the test case,
 * and only as the default location of its underlag. The case itself (property, codes, quantities,
 * names) is never a literal in the demo code: it is read from DEMO_UNDERLAG_DIR through
 * underlagLoader.ts, quoted verbatim with file + sha256.
 *
 *   DEMO_UNDERLAG_DIR      folder with the user's underlag files (default: the testcase folder)
 *   DEMO_UNDERLAG_MAPPING  mapping of input fields to verbatim excerpts (kept outside the repo)
 */
import fs from 'node:fs';
import { loadUnderlag, type UnderlagMapping } from './underlagLoader';

export const DEFAULT_UNDERLAG_DIR =
  'C:\\miljöbeslut\\Claude outputs\\demo-01-testcase-orsa-stackmora-3-12\\jimmy-underlag';
export const DEFAULT_UNDERLAG_MAPPING = 'C:\\miljöbeslut\\Claude outputs\\demo-01-writer\\underlag\\mapping.json';

export function underlagDir(): string {
  return process.env.DEMO_UNDERLAG_DIR || DEFAULT_UNDERLAG_DIR;
}

export function underlagMappingPath(): string {
  return process.env.DEMO_UNDERLAG_MAPPING || DEFAULT_UNDERLAG_MAPPING;
}

export function seedFromUnderlag() {
  const dir = underlagDir();
  const mapping = JSON.parse(fs.readFileSync(underlagMappingPath(), 'utf8')) as UnderlagMapping;
  return { dir, ...loadUnderlag(dir, mapping) };
}
