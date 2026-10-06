/**
 * W-NO-GOOGLE-02. Fail closed if an active execution surface imports or calls Google.
 * Docs, governance evidence, markdown, and inert Cesium vendor code are outside the scan.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const SCAN_ROOTS = [
  'server',
  'scripts',
  'services',
  'src',
  'prompt_optimizer',
  '.github/workflows',
];

const ALLOW = [
  /^docs\//,
  /^public\/cesium\//,
  /^governance\//,
  /\.md$/,
  /^tests\/unit\/noGoogleRuntimeGuard\.test\.ts$/,
];

const RULES: ReadonlyArray<{ id: string; re: RegExp }> = [
  {
    id: 'google-sdk-import',
    re: /from\s+['"]@google(?:-cloud)?\/|import\(\s*['"]@google|from\s+['"]google-auth-library['"]|require\(\s*['"]@google|from\s+google\.cloud|import\s+vertexai\b|google\.adk/,
  },
  { id: 'googleapis-host', re: /googleapis\.com/ },
  { id: 'gsutil', re: /\bgsutil\b/ },
  { id: 'gcloud', re: /\bgcloud\b/ },
];

function tracked(dir: string): string[] {
  const out = execFileSync('git', ['ls-files', '--', dir], { cwd: ROOT, encoding: 'utf8' });
  return out.split(/\r?\n/).filter(Boolean);
}

describe('no-google runtime guard', () => {
  it('active execution files do not import or call Google', () => {
    const hits: string[] = [];
    for (const root of SCAN_ROOTS) {
      for (const rel of tracked(root)) {
        const normalized = rel.replace(/\\/g, '/');
        if (ALLOW.some((re) => re.test(normalized))) continue;
        const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
        for (const rule of RULES) {
          if (rule.re.test(text)) hits.push(`${rule.id} ${normalized}`);
        }
      }
    }
    expect(hits, hits.join('\n')).toEqual([]);
  });
});
