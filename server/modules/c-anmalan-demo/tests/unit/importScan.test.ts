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
