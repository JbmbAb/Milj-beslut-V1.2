/**
 * U30F F1 (PRES-05): legacy scripts that drop, truncate, overwrite or redefine protected LU or
 * retained-staging relations outside the governed path are RETIRED: each refuses with
 * REJECT_RETIRED_DESTRUCTIVE_SCRIPT before any statement reaches a database or any process is
 * spawned, even with --execute.
 *
 * Hermetic: @prisma/client, dotenv, src/db.server and child_process are replaced by recorders; the
 * real modules are never evaluated. A script that is NOT refused would run its main() against the
 * recorder, so a recorded statement or spawn is the RED signal.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  const state = { statements: [] as string[], spawned: [] as string[] };
  const record = (kind: string) => (...args: unknown[]) => {
    const first = args[0];
    state.statements.push(`${kind}:${Array.isArray(first) ? first.join('?') : String(first)}`);
    return Promise.resolve([]);
  };
  class FakePrismaClient {
    $executeRawUnsafe = record('execute');
    $queryRawUnsafe = record('query');
    $executeRaw = record('execute');
    $queryRaw = record('query');
    async $transaction(arg: unknown) {
      state.statements.push('transaction');
      return Array.isArray(arg) ? Promise.all(arg) : (arg as (tx: unknown) => Promise<unknown>)(this);
    }
    async $disconnect() {}
  }
  const spawnRecorder = (cmd: unknown) => {
    state.spawned.push(String(cmd));
    return { status: 1, stdout: '', stderr: 'recorded, not run' };
  };
  return { state, FakePrismaClient, prisma: new FakePrismaClient(), spawnRecorder };
});

vi.mock('@prisma/client', () => ({ PrismaClient: h.FakePrismaClient }));
// U30F2 H2: the repair scripts talk to PostgreSQL through `pg`; a statement recorded here is the RED signal.
vi.mock('pg', () => {
  class FakePgClient {
    async connect() {}
    async query(sql: unknown) {
      h.state.statements.push(`pg:${String(sql).replace(/\s+/g, ' ').trim()}`);
      return { rows: [], rowCount: 0 };
    }
    async end() {}
    release() {}
  }
  class FakePgPool extends FakePgClient {
    async connect() {
      return new FakePgClient();
    }
  }
  const pg = { Client: FakePgClient, Pool: FakePgPool };
  return { ...pg, default: pg };
});
vi.mock('dotenv', () => ({ default: { config: () => ({}) }, config: () => ({}) }));
vi.mock('../../src/db.server', () => ({ prisma: h.prisma }));
vi.mock('../../src/infrastructure/postgis-geo-adapter', () => ({ PostgisGeoAdapter: class {} }));
for (const specifier of ['child_process', 'node:child_process']) {
  vi.doMock(specifier, async () => {
    const actual = await vi.importActual<Record<string, unknown>>('node:child_process');
    const fake = { ...actual, spawnSync: h.spawnRecorder, execSync: h.spawnRecorder, spawn: h.spawnRecorder, execFileSync: h.spawnRecorder };
    return { ...fake, default: fake };
  });
}

const RETIRED_TS = [
  'scripts/db/drop-staging-tables.ts',
  'scripts/db/adopt-staging-to-prod.ts',
  'scripts/db/restore-sgu-soil.ts',
  'scripts/db/merge-property-parts.ts',
  'scripts/db/refine-mapping.ts',
  'scripts/db/refine-mapping-v2.ts',
  'scripts/clean-sgu-pipeline.ts',
  'scripts/gis-performance-benchmark.ts',
  'scripts/verify-jordarter.ts',
  'scripts/import/import-n2k-gml.ts',
  // U30F2 H2: write to retained relations in lm_staging outside the governed path.
  'scripts/db/repair-flood-staging-geometries.ts',
  'scripts/db/repair-flood-staging-geometries-fast.ts',
  'scripts/db/repair-flood-staging-geometries-batched.ts',
  'scripts/db/repair-marktacke-staging.ts',
] as const;

const RETIRED_SQL = [
  'scripts/db/subdivide-complex-polygons.sql',
  'scripts/db/partition-spatial-grid.sql',
  'scripts/db/migrate-partition-fastigheter.sql',
] as const;

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const savedArgv = process.argv;

beforeEach(() => {
  h.state.statements.length = 0;
  h.state.spawned.length = 0;
  process.argv = [process.argv[0]!, 'retired-script', '--execute'];
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
});

afterEach(() => {
  vi.restoreAllMocks();
  process.argv = savedArgv;
});

describe('retired destructive scripts refuse before any statement (U30F F1)', () => {
  it.each(RETIRED_TS)('%s', async (script) => {
    vi.resetModules();
    const outcome = await import(/* @vite-ignore */ path.join(repoRoot, script)).then(
      () => null,
      (error: unknown) => error,
    );
    // Let a script that was NOT refused run its async main() against the recorders.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(h.state.statements, `${script} reached the database`).toEqual([]);
    expect(h.state.spawned, `${script} spawned a process`).toEqual([]);
    expect(outcome).toBeInstanceOf(Error);
    expect((outcome as Error).message).toContain(`REJECT_RETIRED_DESTRUCTIVE_SCRIPT: ${script}`);
  });

  it.each(RETIRED_SQL)('%s refuses first, and again inside its own transaction', (script) => {
    const lines = readFileSync(path.join(repoRoot, script), 'utf8').split(/\r?\n/);
    const code = lines.map((l) => l.trim()).filter((l) => l.length > 0 && !l.startsWith('--'));
    expect(code[0]).toBe('\\set ON_ERROR_STOP on');
    expect(code[1]).toMatch(new RegExp(`^DO \\$\\$ BEGIN RAISE EXCEPTION 'REJECT_RETIRED_DESTRUCTIVE_SCRIPT: ${script.replace(/\./g, '\\.')}`));
    const begin = code.indexOf('BEGIN;');
    expect(begin).toBeGreaterThan(1);
    expect(code[begin + 1]).toMatch(/^DO \$\$ BEGIN RAISE EXCEPTION 'REJECT_RETIRED_DESTRUCTIVE_SCRIPT: /);
  });
});
