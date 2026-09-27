// @vitest-environment node
/**
 * K-26 §1: the demo path must not reach the legacy mass GIS, the ungoverned spatial audit or the
 * legacy UI with its hard-coded "AI-förslag" — not directly and not transitively. Walks the
 * relative-import graph from the demo entry files (server module + client view).
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../../../../..');
const MODULE_DIR = path.join(ROOT, 'server/modules/c-anmalan-demo');
const CLIENT_DIR = path.join(ROOT, 'components/demo/c-anmalan');

const FORBIDDEN = [
  'server/modules/c-notification-mass/massGisService.ts',
  'server/services/spatialAuditService.ts',
  'components/admin/modules/c-notification-mass/CNotificationMassUI.tsx',
  'server/modules/c-notification-mass/massOrchestrator.ts',
  'server/routes/cNotificationMass.routes.ts',
];

const listSources = (dir: string): string[] =>
  fs.existsSync(dir)
    ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) return e.name === 'tests' ? [] : listSources(p);
        return /\.(ts|tsx)$/.test(e.name) ? [p] : [];
      })
    : [];

function resolveImport(from: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null; // packages are not demo-path code
  const base = path.resolve(path.dirname(from), spec);
  for (const cand of [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts'), path.join(base, 'index.tsx')]) {
    if (fs.existsSync(cand) && fs.statSync(cand).isFile()) return cand;
  }
  return null;
}

// from-imports/re-exports, side-effect imports, dynamic import() and require().
const IMPORT_RE = /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|require\(\s*['"]([^'"]+)['"]\s*\)|^\s*import\s*['"]([^'"]+)['"]/gm;

function reachable(entries: string[]): Set<string> {
  const seen = new Set<string>();
  const stack = [...entries];
  while (stack.length) {
    const file = stack.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const src = fs.readFileSync(file, 'utf8');
    for (const m of src.matchAll(IMPORT_RE)) {
      const target = resolveImport(file, m[1] ?? m[2] ?? m[3] ?? m[4]);
      if (target && !seen.has(target)) stack.push(target);
    }
  }
  return seen;
}

const rel = (p: string) => path.relative(ROOT, p).replace(/\\/g, '/');

describe('DEMO-01 import scan (K-26 §1)', () => {
  const entries = [...listSources(MODULE_DIR), ...listSources(CLIENT_DIR)];
  const graph = [...reachable(entries)].map(rel);

  it('has entry files for both server module and client view', () => {
    expect(entries.some((f) => rel(f) === 'server/modules/c-anmalan-demo/routes.ts')).toBe(true);
    expect(entries.some((f) => rel(f).startsWith('components/demo/c-anmalan/'))).toBe(true);
  });

  it('never reaches massGisService, spatialAuditService, CNotificationMassUI or the legacy mass flow', () => {
    expect(graph.filter((f) => FORBIDDEN.includes(f))).toEqual([]);
  });

  it('contains no hard-coded fake-RAG material in demo-path files', () => {
    const own = graph.filter((f) => f.startsWith('server/modules/c-anmalan-demo/') || f.startsWith('components/demo/c-anmalan/'));
    const hits = own.flatMap((f) => {
      const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
      return [/RAG_SUGGESTIONS/, /Brynäs/i, /Gävle/i, /\bconfidence\b/i, /Infoga AI-förslag/, /juridiskt verifierad/i, /RAG Konfidens/]
        .filter((re) => re.test(src))
        .map((re) => `${f}: ${re}`);
    });
    expect(hits).toEqual([]);
  });

  it('exposes no submit route', () => {
    const routes = fs.readFileSync(path.join(MODULE_DIR, 'routes.ts'), 'utf8');
    expect(routes).not.toMatch(/submit['"`/]/i);
    expect(routes).not.toMatch(/router\.(post|put)\([^)]*(skicka|submit|inlamn)/i);
  });

  it('is mounted only behind DEMO_C_ANMALAN_ENABLED and CNotificationMassUI stays unmounted', () => {
    const createApp = fs.readFileSync(path.join(ROOT, 'server/createApp.ts'), 'utf8');
    expect(createApp).toMatch(/if \(isDemoCAnmalanEnabled\(\)\) \{\s*app\.use\(cAnmalanDemoRouter\);\s*\}/);
    const appShell = fs.readFileSync(path.join(ROOT, 'components/app/AppShell.tsx'), 'utf8');
    expect(appShell).not.toMatch(/CNotificationMassUI/);
  });
});

/**
 * Charter §0f / K-36 / K-51: the case (property, quantities, names, codes of the test case) must not
 * be a literal in the demo code. Word boundaries matter: "korsar" contains "orsa" and must not match.
 * Since K-51 the seed loader has no default folder, so it is scanned too; only test files are exempt.
 */
export const CASE_LITERALS: RegExp[] = [
  /\bSTACKMORA\b/i,
  /\b3:12\b/,
  /\bJimmy\b/i,
  /\bMillby/i,
  /\b4 800\b/,
  /\b2 100\b/,
  /\b559999/,
  /\bPG-01\b/,
  /\b17 05 04\b/,
  /\bOrsa\b/i,
];
const SEED_LOADER = 'server/modules/c-anmalan-demo/seedUnderlag.ts';

export function literalHits(files: string[]): string[] {
  return files.flatMap((f) => {
    const lines = fs.readFileSync(path.join(ROOT, f), 'utf8').split(/\r?\n/);
    return lines.flatMap((line, i) => CASE_LITERALS.filter((re) => re.test(line)).map((re) => `${f}:${i + 1} ${re}`));
  });
}

describe('DEMO-01 literal scan (charter §0f, K-36)', () => {
  const demoFiles = [...listSources(MODULE_DIR), ...listSources(CLIENT_DIR)].map(rel);

  it('scans both demo trees, including the seed loader; only tests are excluded', () => {
    expect(demoFiles).toContain(SEED_LOADER);
    expect(demoFiles).toContain('server/modules/c-anmalan-demo/routes.ts');
    expect(demoFiles).toContain('components/demo/c-anmalan/CAnmalanDemoView.tsx');
    expect(demoFiles.some((f) => f.includes('/tests/'))).toBe(false);
  });

  it('no case literal anywhere in the demo code (seed loader included)', () => {
    expect(literalHits(demoFiles)).toEqual([]);
  });

  it('the seed loader takes the underlag folder only from DEMO_UNDERLAG_DIR, with no default', () => {
    const src = fs.readFileSync(path.join(ROOT, SEED_LOADER), 'utf8');
    expect(src).toMatch(/process\.env\.DEMO_UNDERLAG_DIR/);
    expect(src).not.toMatch(/DEFAULT_UNDERLAG_DIR/);
    expect(src).not.toMatch(/testcase/i);
  });

  it('word boundaries: "korsar", "Orsasjön-lik" text in other words does not match, the names do', () => {
    expect(CASE_LITERALS.some((re) => re.test('0 korsar fastigheten'))).toBe(false);
    expect(CASE_LITERALS.some((re) => re.test('lagret korsade'))).toBe(false);
    expect(CASE_LITERALS.some((re) => re.test('kommun ORSA'))).toBe(true);
    expect(CASE_LITERALS.some((re) => re.test('STACKMORA'))).toBe(true);
    expect(CASE_LITERALS.some((re) => re.test('dnr 2 100-12'))).toBe(true);
  });
});
