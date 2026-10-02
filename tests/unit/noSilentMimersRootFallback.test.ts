// tests/unit/noSilentMimersRootFallback.test.ts
//
// U30-A (PRES-19) guard: no product, worker or ceremony/proof code may fall back to a
// cwd-relative CAS root when MIMERS_ROOT is unset (`MIMERS_ROOT || path.resolve('.data/mimers')`
// and the like). The durable root is resolved only through resolveDurableMimersRoot(), which
// fails closed with MIMERS_ROOT_REQUIRED. The eight ceremony/proof scripts that carried such a
// fallback (they write document-evidence artifacts that DoD v1 depends on) are pinned by name.
//
// Pure source scan; nothing is executed.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();

const PROOF_SCRIPTS = [
  'scripts/ops/prove-document-evidence-canonical-admission-01.ts',
  'scripts/ops/prove-document-fact-candidate-01.ts',
  'scripts/ops/prove-document-fact-candidate-reissue-01.ts',
  'scripts/ops/prove-document-fact-human-verification-01.ts',
  'scripts/ops/prove-document-fact-human-verification-approved-01.ts',
  'scripts/ops/prove-document-source-to-text-projection-01.ts',
  'scripts/ops/prove-document-evidence-v2-unbound-01.ts',
  'scripts/ops/prove-h15-document-evidence-rehash-cold-replay-01.ts',
] as const;

/** Code lines only: drops lines that are (part of) comments, so documentation may name the old pattern. */
function codeLines(source: string): string[] {
  const out: string[] = [];
  let inBlock = false;
  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (inBlock) {
      if (trimmed.includes('*/')) inBlock = false;
      continue;
    }
    if (trimmed.startsWith('/*')) {
      if (!trimmed.includes('*/')) inBlock = true;
      continue;
    }
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;
    out.push(line);
  }
  return out;
}

const FALLBACK_PATTERNS: readonly RegExp[] = [
  /MIMERS_ROOT\s*(\|\||\?\?)/, // process.env.MIMERS_ROOT || <anything>
  /['"`]\.data[/\\]+mimers/, // a literal .data/mimers root
  /['"]\.data['"]\s*,\s*['"]mimers['"]/, // path.join('.data', 'mimers')
];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === 'coverage') continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      walk(full, out);
    } else if (/\.(ts|tsx|mts|mjs|js)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

describe('no silent MIMERS_ROOT fallback (U30-A, PRES-19)', () => {
  it.each(PROOF_SCRIPTS)('%s resolves the durable root through the shared contract', (file) => {
    const source = readFileSync(path.join(repoRoot, file), 'utf8');
    const code = codeLines(source).join('\n');
    expect(code).toContain('resolveDurableMimersRoot(process.env,');
    for (const pattern of FALLBACK_PATTERNS) {
      expect(code, `${file} matches ${pattern}`).not.toMatch(pattern);
    }
  });

  it('server/, packages/*/src and scripts/ contain no MIMERS_ROOT fallback in code', () => {
    const roots = [
      path.join(repoRoot, 'server'),
      path.join(repoRoot, 'scripts'),
      ...readdirSync(path.join(repoRoot, 'packages'))
        .map((pkg) => path.join(repoRoot, 'packages', pkg, 'src'))
        .filter((dir) => {
          try {
            return statSync(dir).isDirectory();
          } catch {
            return false;
          }
        }),
    ];
    const violations: string[] = [];
    for (const root of roots) {
      for (const file of walk(root)) {
        const lines = codeLines(readFileSync(file, 'utf8'));
        for (const line of lines) {
          if (FALLBACK_PATTERNS.some((pattern) => pattern.test(line))) {
            violations.push(`${path.relative(repoRoot, file)}: ${line.trim()}`);
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
