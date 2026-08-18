import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  assertRequiredSpatialExtensions,
  MissingSpatialExtensionsError,
  REQUIRED_SPATIAL_EXTENSIONS,
} from '../setup/requiredSpatialExtensions';

/**
 * GIS_TEST_DB_EXTENSION_OWNERSHIP-01 proof. Database-free: the check is a single SELECT behind
 * a narrow structural type, so the whole matrix runs without Postgres.
 */

const pgSpies = vi.hoisted(() => ({
  connect: vi.fn(),
  query: vi.fn(),
  end: vi.fn(),
}));

vi.mock('pg', () => ({
  default: {
    Client: class {
      connect = pgSpies.connect;
      query = pgSpies.query;
      end = pgSpies.end;
    },
  },
}));

const ALL_PRESENT = REQUIRED_SPATIAL_EXTENSIONS.map((extname) => ({ extname }));

function clientWith(extnames: readonly string[]) {
  return {
    query: vi.fn(async () => ({ rows: extnames.map((extname) => ({ extname })) })),
  };
}

describe('assertRequiredSpatialExtensions', () => {
  it.each(['postgis', 'postgis_raster', 'pg_trgm', 'unaccent'])(
    'rejects when %s is missing',
    async (missing) => {
      const client = clientWith(REQUIRED_SPATIAL_EXTENSIONS.filter((n) => n !== missing));

      await expect(assertRequiredSpatialExtensions(client, 'riskguard_test')).rejects.toThrow(
        MissingSpatialExtensionsError,
      );
    },
  );

  it('names every missing extension and points at the provisioner', async () => {
    const client = clientWith(['unaccent']);

    await expect(assertRequiredSpatialExtensions(client, 'riskguard_test')).rejects.toThrow(
      /postgis, postgis_raster, pg_trgm[\s\S]*provision-spatial-test-db\.ts/,
    );
  });

  it('issues only a read-only SELECT, never DDL', async () => {
    const client = clientWith(REQUIRED_SPATIAL_EXTENSIONS);

    await assertRequiredSpatialExtensions(client, 'riskguard_test');

    expect(client.query).toHaveBeenCalledTimes(1);
    expect(client.query.mock.calls[0][0]).toMatch(/^SELECT extname FROM pg_extension$/);
  });

  it('admits when every required extension is installed', async () => {
    const client = clientWith([...REQUIRED_SPATIAL_EXTENSIONS, 'vector', 'plpgsql']);

    await expect(assertRequiredSpatialExtensions(client, 'riskguard_test')).resolves.toBeUndefined();
  });
});

describe('destructive setup — extension lifecycle removed from runtime', () => {
  let workdir: string;
  let cwdSpy: ReturnType<typeof vi.spyOn>;
  const savedEnv = { ...process.env };

  beforeEach(() => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'gis-ext-'));
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(workdir);
    pgSpies.connect.mockReset();
    pgSpies.query.mockReset();
    pgSpies.end.mockReset();
    delete process.env.DATABASE_URL;
    delete process.env.GIS_TEST_DB_DISPOSABLE;
    delete process.env.GIS_TEST_DB_NAME;

    // An admitted disposable database, so DB-0-SAFETY passes and this unit is what is proven.
    fs.writeFileSync(
      path.join(workdir, '.env.test'),
      'DATABASE_URL=postgresql://riskguard:pw@127.0.0.1:5432/riskguard_test\n' +
        'GIS_TEST_DB_DISPOSABLE=1\nGIS_TEST_DB_NAME=riskguard_test\n',
    );
  });

  afterEach(() => {
    cwdSpy.mockRestore();
    fs.rmSync(workdir, { recursive: true, force: true });
    process.env = { ...savedEnv };
    vi.resetModules();
  });

  async function runStubs() {
    const { applyGisTestStubs } = await import('../setup/seedGisStubs');
    return applyGisTestStubs();
  }

  const executedSql = () => pgSpies.query.mock.calls.map(([sql]) => String(sql)).join('\n');

  it('fails before any schema mutation when postgis is absent', async () => {
    pgSpies.query.mockResolvedValue({ rows: [{ extname: 'unaccent' }] });

    await expect(runStubs()).rejects.toThrow(MissingSpatialExtensionsError);

    // The extension check is the only statement that ran.
    expect(pgSpies.query).toHaveBeenCalledTimes(1);
    expect(executedSql()).not.toMatch(/DROP\s+SCHEMA|DROP\s+TABLE|DELETE\s+FROM/i);
  });

  it('fails before any schema mutation when postgis_raster is absent', async () => {
    pgSpies.query.mockResolvedValue({
      rows: [{ extname: 'postgis' }, { extname: 'unaccent' }, { extname: 'pg_trgm' }],
    });

    await expect(runStubs()).rejects.toThrow(/postgis_raster/);
    expect(executedSql()).not.toMatch(/DROP\s+SCHEMA|DROP\s+TABLE|DELETE\s+FROM/i);
  });

  it('fails before the trigram index is created when pg_trgm is absent', async () => {
    pgSpies.query.mockResolvedValue({
      rows: [{ extname: 'postgis' }, { extname: 'postgis_raster' }, { extname: 'unaccent' }],
    });

    await expect(runStubs()).rejects.toThrow(/pg_trgm/);
    expect(executedSql()).not.toMatch(/gin_trgm_ops/i);
  });

  it('CONTROL: runtime SQL contains zero DROP EXTENSION and zero CREATE EXTENSION', async () => {
    pgSpies.query.mockResolvedValue({ rows: ALL_PRESENT });

    await runStubs();

    const sql = executedSql();
    expect(sql).not.toMatch(/DROP\s+EXTENSION/i);
    expect(sql).not.toMatch(/CREATE\s+EXTENSION/i);
    // and the schema reset it is allowed to do did happen
    expect(sql).toMatch(/DROP TABLE IF EXISTS env\.protected_area CASCADE/i);
  });

  it('proceeds with the schema reset when every required extension is present', async () => {
    pgSpies.query.mockResolvedValue({ rows: ALL_PRESENT });

    await expect(runStubs()).resolves.toBeUndefined();
    expect(pgSpies.connect).toHaveBeenCalledTimes(1);
    expect(pgSpies.end).toHaveBeenCalledTimes(1);
  });
});
