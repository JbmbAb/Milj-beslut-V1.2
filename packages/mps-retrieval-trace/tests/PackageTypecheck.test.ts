import { describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * LEGAL-RETRIEVAL-TRACE-REPAIR-01.
 *
 * mps-retrieval-trace's own KNOWN_BROKEN defect (two dead files importing a module that never
 * existed anywhere in the repo, ../../mps-retrieval-governance/src/ArtifactReader) was invisible
 * to `vitest run` for months: esbuild's transform elides an unused type-only import at emit time,
 * so a broken module specifier that only appears in a type position never even gets resolved.
 * `npx vitest run` reported "all green" the entire time the package was uncompilable.
 *
 * This test closes that blind spot two ways: (1) proves the package's OWN scoped tsc project
 * (package.json's `typecheck` script) is clean right now, and (2) proves the mechanism itself --
 * not just this specific file -- actually catches a broken relative import of this exact shape,
 * so a future regression of the same class is caught by `vitest run`, not silently passed.
 */
const PACKAGE_ROOT = join(__dirname, '..');

describe('LEGAL-RETRIEVAL-TRACE-REPAIR-01 — package typecheck', () => {
  it('the package\'s own tsc --noEmit passes cleanly (no broken import survives esbuild\'s type-erasure blind spot)', () => {
    expect(() =>
      execSync('npx tsc --noEmit -p tsconfig.json', { cwd: PACKAGE_ROOT, stdio: 'pipe' }),
    ).not.toThrow();
  });

  it('REGRESSION MECHANISM PROOF: tsc (not vitest) actually catches a broken relative import of the same shape that hid here for months', () => {
    // A minimal, isolated repro of the exact defect class: a .ts file importing a type-only
    // symbol from a relative path that does not exist. esbuild (vitest's transform) would elide
    // this silently; tsc must not.
    const scratchDir = mkdtempSync(join(tmpdir(), 'retrieval-trace-typecheck-proof-'));
    try {
      const brokenFile = join(scratchDir, 'broken.ts');
      writeFileSync(
        brokenFile,
        `import { NeverBuilt } from './this-module-does-not-exist';\nexport function use(x: NeverBuilt): NeverBuilt { return x; }\n`,
      );

      let threw = false;
      try {
        execSync(
          `npx tsc --noEmit --strict false --module esnext --moduleResolution bundler "${brokenFile}"`,
          { cwd: scratchDir, stdio: 'pipe' },
        );
      } catch {
        threw = true;
      }

      expect(threw).toBe(true);
    } finally {
      rmSync(scratchDir, { recursive: true, force: true });
    }
  });
});
