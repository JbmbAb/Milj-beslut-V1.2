/**
 * K0-FIX-1 (b) -- the dead, ungoverned document packaging is gone from @miljobeslut/mps-lu.
 *
 * K0 (DOC-EVIDENCE-CENSUS 2026-10-02) took the presentation-only document fallback out of every LU
 * product path, but left the code behind:
 *   - LUBackendOrchestrator.generateDocumentEvidence: packaged provider output as DOCUMENT_EVIDENCE
 *     with random ids and content_hash "uncalculated" (DocumentEvidenceService); no product caller,
 *     only test stubs.
 *   - LUBackendOrchestrator.generateKnowledgeFinding: a municipality lookup with a fabricated
 *     `|| "Mora"` fallback; no caller at all.
 *   - LU_DOC_PROVIDER=postgis: an explicit opt-in to the municipality-wide DocumentRecord sweep.
 *   - a dynamic import of MockDocumentProvider from package code.
 * Because the package root re-exported the orchestrator (and its `orchestrator` singleton), every
 * import of @miljobeslut/mps-lu also loaded server/db/prisma and server/loadEnv.
 *
 * These checks are static: they read files and execute no product code, so they cannot reach a
 * database whatever the environment.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';

const PKG = resolve(__dirname, '..');
const LU_SRC = join(PKG, 'src');
const REPO = resolve(PKG, '..', '..');

const posix = (p: string) => p.replace(/\\/g, '/');
/** Comments describe history; only code may violate the rule. */
const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
/** Static imports, re-exports, dynamic import() and require(). */
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)['"]([^'"\n]+)['"]/g;

function sourceFiles(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist') continue;
      sourceFiles(full, out);
    } else if (/\.(ts|tsx|mts|js|mjs|cjs)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

function asFile(base: string): string | null {
  const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}.mts`, `${base}.js`, `${base}.mjs`, join(base, 'index.ts'), join(base, 'index.js')];
  if (/\.(js|mjs|cjs)$/.test(base)) candidates.push(base.replace(/\.(js|mjs|cjs)$/, '.ts'), base.replace(/\.(js|mjs|cjs)$/, '.tsx'));
  return candidates.find((c) => existsSync(c) && statSync(c).isFile()) ?? null;
}

/**
 * Every module a load of `entry` can reach through relative and @miljobeslut/* specifiers (the same
 * mapping as tsconfig `paths`). A followed specifier that does not resolve is reported, so the walk
 * cannot silently stop short of a module it should have seen.
 */
function reachableFrom(repoRoot: string, entry: string): { reached: string[]; unresolved: string[] } {
  const seen = new Set<string>();
  const unresolved: string[] = [];
  const stack = [entry];
  while (stack.length > 0) {
    const file = stack.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    if (!/\.(ts|tsx|mts|js|mjs|cjs)$/.test(file)) continue;
    const code = stripComments(readFileSync(file, 'utf8'));
    for (const match of code.matchAll(SPECIFIER)) {
      const spec = match[1]!;
      let target: string | null;
      if (spec.startsWith('.')) {
        target = asFile(resolve(dirname(file), spec));
      } else {
        const pkg = /^@miljobeslut\/([^/]+)(\/.*)?$/.exec(spec);
        if (!pkg) continue;
        target = asFile(pkg[2] ? join(repoRoot, 'packages', pkg[1]!, pkg[2]) : join(repoRoot, 'packages', pkg[1]!, 'src', 'index'));
      }
      if (target === null) unresolved.push(`${posix(relative(repoRoot, file))} -> ${spec}`);
      else if (!seen.has(target)) stack.push(target);
    }
  }
  return { reached: [...seen].map((f) => posix(relative(repoRoot, f))).sort(), unresolved };
}

/** Modules that open a database client or read env files. The LU package root must reach none. */
const DB_OR_ENV_LOADER = /^(server\/db\/|server\/config\/prisma|server\/loadEnv|packages\/alpha-runtime\/)/;

describe('K0-FIX-1 (b): the dead, ungoverned document packaging is gone from @miljobeslut/mps-lu', () => {
  it('the orchestrator and the packaging service no longer exist', () => {
    expect(existsSync(join(LU_SRC, 'api', 'LUBackendOrchestrator.ts'))).toBe(false);
    expect(existsSync(join(LU_SRC, 'services', 'DocumentEvidenceService.ts'))).toBe(false);
  });

  it('no LU source file defines, calls or imports the removed packaging, the "Mora" fallback or the mock provider', () => {
    const files = sourceFiles(LU_SRC);
    expect(files.length, 'a scan over an empty file list proves nothing').toBeGreaterThan(50);

    const offenders: string[] = [];
    for (const file of files) {
      const code = stripComments(readFileSync(file, 'utf8'));
      const rel = posix(relative(REPO, file));
      for (const [label, pattern] of [
        ['generateDocumentEvidence', /\bgenerateDocumentEvidence\b/],
        ['generateKnowledgeFinding', /\bgenerateKnowledgeFinding\b/],
        ['DocumentEvidenceService', /\bDocumentEvidenceService\b/],
        ['LUBackendOrchestrator', /\bLUBackendOrchestrator\b/],
        ['MockDocumentProvider', /\bMockDocumentProvider\b/],
        ['"Mora" literal', /["'`]Mora["'`]/],
      ] as const) {
        if (pattern.test(code)) offenders.push(`${rel}: ${label}`);
      }
      for (const match of code.matchAll(SPECIFIER)) {
        if (/document-provider/.test(match[1]!)) offenders.push(`${rel}: imports ${match[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the package root exports neither the orchestrator class nor its singleton', () => {
    const index = stripComments(readFileSync(join(LU_SRC, 'index.ts'), 'utf8'));
    expect(index).not.toMatch(/api\/LUBackendOrchestrator/);

    // The Step-4 API-boundary test binds this snapshot to the real export surface.
    const snapshot = JSON.parse(readFileSync(join(PKG, 'api-boundary.snapshot.json'), 'utf8')) as {
      public_exports: string[];
    };
    expect(snapshot.public_exports).not.toContain('orchestrator');
    expect(snapshot.public_exports).not.toContain('LUBackendOrchestrator');
    expect(snapshot.public_exports).toContain('resolveDocumentProviderFromEnv');
  });

  it('importing the package root reaches no database client, env loader or document-provider module', () => {
    const { reached, unresolved } = reachableFrom(REPO, join(LU_SRC, 'index.ts'));

    expect(unresolved, 'every followed specifier must resolve, or the walk could stop short').toEqual([]);
    expect(reached.length, 'the walk is not vacuous').toBeGreaterThan(100);
    expect(reached).toContain('packages/mps-lu/src/execution/LuExecutionKernelClient.ts');

    expect(reached.filter((f) => DB_OR_ENV_LOADER.test(f))).toEqual([]);
    expect(reached.filter((f) => f.startsWith('packages/document-provider/'))).toEqual([]);
  });

  it('CONTROL: the walk and the detectors fire on the shapes they claim to detect', () => {
    const root = mkdtempSync(join(tmpdir(), 'k0fix1b-'));
    try {
      const write = (rel: string, text: string) => {
        mkdirSync(dirname(join(root, rel)), { recursive: true });
        writeFileSync(join(root, rel), text);
      };
      write('packages/mps-lu/src/index.ts', "export * from './api/X';\n");
      write('packages/mps-lu/src/api/X.ts', "export async function f() { return import('../providers/Y'); }\n");
      write('packages/mps-lu/src/providers/Y.ts', "import { prisma } from '../../../../server/db/prisma';\nexport { prisma };\n");
      write('server/db/prisma.ts', "import './../loadEnv';\nexport const prisma = {};\n");
      write('server/loadEnv.ts', 'export {};\n');

      const { reached, unresolved } = reachableFrom(root, join(root, 'packages', 'mps-lu', 'src', 'index.ts'));
      expect(unresolved).toEqual([]);
      expect(reached.filter((f) => DB_OR_ENV_LOADER.test(f))).toEqual(['server/db/prisma.ts', 'server/loadEnv.ts']);

      write('packages/mps-lu/src/api/X.ts', "import { gone } from './Missing';\nexport { gone };\n");
      expect(reachableFrom(root, join(root, 'packages', 'mps-lu', 'src', 'index.ts')).unresolved).toEqual([
        'packages/mps-lu/src/api/X.ts -> ./Missing',
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }

    const dynamicMock = 'const { MockDocumentProvider } = await import(\n  "../../../document-provider/src/MockDocumentProvider"\n);';
    expect([...dynamicMock.matchAll(SPECIFIER)].map((m) => m[1])).toEqual(['../../../document-provider/src/MockDocumentProvider']);
    expect(/["'`]Mora["'`]/.test('const municipality = res[0]?.kommunnamn || "Mora";')).toBe(true);
    expect(stripComments('// orchestrator.generateDocumentEvidence was removed\nconst a = 1;')).not.toMatch(/generateDocumentEvidence/);
  });
});
