/**
 * U30F2 H2 (PRES-05): scripts/db/spatial-bootstrap.ts applies prisma/spatial/*.sql whenever a file is not
 * logged in spatial_migrations or its checksum changed. 004_property_unit_core.sql DROPs core.property_unit
 * (and 005/006 drop and recreate env.ebh_* / env.protected_area); 004 is documented as never applied in
 * production, so a first run there would drop the LU property root.
 *
 * The bootstrap now plans first: every PENDING file is classified by the protected relation gate's
 * classifier; one that writes a protected relation (or runs SQL whose target is not static) is applied only
 * in an explicit initialisation mode (--init-new-database) on a database that holds NO protected relation.
 * Otherwise nothing at all is applied (exit 1). Files already logged with the same checksum are skipped as
 * before, so a release against an already bootstrapped database is unaffected.
 *
 * Hermetic: `pg` is replaced by a scripted pool (no connection); the real prisma/spatial files are only read.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  const state = {
    relations: new Set<string>(),
    schemas: new Set<string>(),
    applied: new Map<string, string>(),
    statements: [] as string[],
  };
  const answer = (sql: string, params: unknown[] = []) => {
    const s = sql.replace(/\s+/g, ' ').trim();
    if (s.startsWith('CREATE EXTENSION')) return { rows: [], rowCount: 0 };
    if (s.includes('FROM information_schema.columns')) return { rows: [{ exists: true }], rowCount: 1 };
    if (s.startsWith('SELECT checksum FROM spatial_migrations')) {
      const c = state.applied.get(String(params[0]));
      return { rows: c ? [{ checksum: c }] : [], rowCount: c ? 1 : 0 };
    }
    if (s.startsWith('SELECT to_regclass')) return { rows: [{ exists: state.relations.has(String(params[0])) }], rowCount: 1 };
    if (s.includes('FROM pg_namespace')) return { rows: [{ exists: state.schemas.has(String(params[0])) }], rowCount: 1 };
    if (s.startsWith('SELECT "fileName", "appliedAt"')) return { rows: [], rowCount: 0 };
    state.statements.push(s.slice(0, 80));
    return { rows: [], rowCount: 0 };
  };
  class FakeClient {
    async query(sql: string, params?: unknown[]) {
      return answer(sql, params);
    }
    release() {}
  }
  class FakePool {
    async query(sql: string, params?: unknown[]) {
      return answer(sql, params);
    }
    async connect() {
      return new FakeClient();
    }
    async end() {}
  }
  return { state, FakePool };
});

vi.mock('pg', () => ({ Pool: h.FakePool, default: { Pool: h.FakePool } }));

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SPATIAL = path.join(repoRoot, 'prisma', 'spatial');
const FILES = readdirSync(SPATIAL).filter((f) => f.endsWith('.sql')).sort((a, b) => a.localeCompare(b));
const checksum = (f: string) => createHash('sha256').update(readFileSync(path.join(SPATIAL, f), 'utf8')).digest('hex');

const savedArgv = process.argv;
const savedUrl = process.env.DATABASE_URL;
let output: string[];
let exitCodes: number[];

beforeEach(() => {
  h.state.relations.clear();
  h.state.schemas.clear();
  h.state.applied.clear();
  h.state.statements.length = 0;
  output = [];
  exitCodes = [];
  process.env.DATABASE_URL = 'postgresql://x:x@127.0.0.1:1/none';
  for (const m of ['log', 'warn', 'error'] as const) vi.spyOn(console, m).mockImplementation((...a: unknown[]) => void output.push(a.map(String).join(' ')));
  vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    exitCodes.push(code ?? 0);
  }) as never);
});

afterEach(() => {
  vi.restoreAllMocks();
  process.argv = savedArgv;
  process.env.DATABASE_URL = savedUrl;
});

async function runBootstrap(args: string[] = []): Promise<void> {
  vi.resetModules();
  process.argv = [process.argv[0]!, 'spatial-bootstrap.ts', ...args];
  await import(/* @vite-ignore */ path.join(repoRoot, 'scripts/db/spatial-bootstrap.ts'));
  for (let i = 0; i < 40; i += 1) await new Promise((r) => setTimeout(r, 5));
}

const appliedFiles = () => h.state.statements.filter((s) => s.startsWith('INSERT INTO spatial_migrations') || s.startsWith('UPDATE spatial_migrations'));

describe('spatial-bootstrap never drops or rewrites a protected relation (U30F2 H2)', () => {
  it('production-like database: core.property_unit exists, 004 never applied -> nothing is applied, exit 1, the refusal names 004', async () => {
    h.state.relations.add('core.property_unit').add('env.registerenhetsomradesytor').add('env.sgu_well');
    h.state.schemas.add('lm_staging');
    for (const f of FILES.filter((f) => !f.startsWith('004'))) h.state.applied.set(f, checksum(f));
    await runBootstrap();
    expect(h.state.statements.filter((s) => s === 'BEGIN')).toEqual([]);
    expect(appliedFiles()).toEqual([]);
    expect(output.join('\n')).toMatch(/REJECT_SPATIAL_MIGRATION_TOUCHES_PROTECTED_RELATION/);
    expect(output.join('\n')).toContain('004_property_unit_core.sql');
    expect(output.join('\n')).toContain('core.property_unit');
    expect(exitCodes).toContain(1);
  });

  it('the explicit initialisation mode does not help on a database that holds protected relations', async () => {
    h.state.relations.add('core.property_unit');
    for (const f of FILES.filter((f) => !f.startsWith('004'))) h.state.applied.set(f, checksum(f));
    await runBootstrap(['--init-new-database']);
    expect(h.state.statements.filter((s) => s === 'BEGIN')).toEqual([]);
    expect(output.join('\n')).toMatch(/protected relations present: core\.property_unit/);
    expect(exitCodes).toContain(1);
  });

  it('a database that holds only the retained-staging schema (lm_staging) is not new: refused even in initialisation mode', async () => {
    h.state.schemas.add('lm_staging');
    await runBootstrap(['--init-new-database']);
    expect(appliedFiles()).toEqual([]);
    expect(output.join('\n')).toMatch(/protected relations present: lm_staging\.\*/);
    expect(exitCodes).toContain(1);
  });

  it('a changed checksum of an already applied protected-touching file is refused too', async () => {
    h.state.relations.add('env.protected_area');
    for (const f of FILES) h.state.applied.set(f, f.startsWith('006') ? 'f'.repeat(64) : checksum(f));
    await runBootstrap();
    expect(appliedFiles()).toEqual([]);
    expect(output.join('\n')).toContain('006_protected_area_physical_boundary.sql');
    expect(exitCodes).toContain(1);
  });

  it('a new, empty database without the explicit initialisation mode -> nothing applied, exit 1', async () => {
    await runBootstrap();
    expect(appliedFiles()).toEqual([]);
    expect(output.join('\n')).toMatch(/--init-new-database/);
    expect(exitCodes).toContain(1);
  });

  it('a new, empty database WITH the explicit initialisation mode -> every file applied in order', async () => {
    await runBootstrap(['--init-new-database']);
    expect(appliedFiles()).toHaveLength(FILES.length);
    expect(exitCodes).toEqual([]);
  });

  it('an already bootstrapped database (every file logged, same checksum) is unchanged: nothing applied, no refusal', async () => {
    h.state.relations.add('core.property_unit').add('env.sgu_well');
    for (const f of FILES) h.state.applied.set(f, checksum(f));
    await runBootstrap();
    expect(appliedFiles()).toEqual([]);
    expect(output.join('\n')).not.toMatch(/REJECT_SPATIAL_MIGRATION/);
    expect(exitCodes).toEqual([]);
  });
});
