import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  admitDisposableGisTestDatabase,
  assertDisposableGisTestDatabase,
  DisposableGisTestDatabaseError,
  type DisposableGisTestDatabaseConfig,
} from '../setup/disposableGisTestDatabase';

/**
 * DB-0-SAFETY proof. Deliberately database-free: the admission check is pure, so the whole
 * rejection matrix is provable without Postgres. This matters because the test database has
 * a separate, unrelated extension-ownership defect (GIS_TEST_DB_EXTENSION_OWNERSHIP-01) that
 * must not be allowed to gate the safety proof.
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

// TEST-DB-GUARD (OD-K0-5): 5433 is the documented disposable test DB port; 5432 on this workstation
// is the live `miljobeslut-postgres` container and is refused even for an allowlisted name.
const ADMITTED_URL = 'postgresql://user:pw@localhost:5433/riskguard_test';

const ADMITTED: DisposableGisTestDatabaseConfig = {
  envTestPresent: true,
  databaseUrl: ADMITTED_URL,
  disposableFlag: '1',
  declaredDatabaseName: 'riskguard_test',
  optInDatabaseName: 'riskguard_test',
};

describe('assertDisposableGisTestDatabase — rejection matrix', () => {
  const rejected: ReadonlyArray<[string, DisposableGisTestDatabaseConfig]> = [
    ['.env.test absent, no fallback to .env', { ...ADMITTED, envTestPresent: false }],
    ['missing DATABASE_URL', { ...ADMITTED, databaseUrl: undefined }],
    ['empty DATABASE_URL', { ...ADMITTED, databaseUrl: '   ' }],
    ['malformed DATABASE_URL', { ...ADMITTED, databaseUrl: 'not-a-url' }],
    [
      'DATABASE_URL names no database',
      { ...ADMITTED, databaseUrl: 'postgresql://user:pw@localhost:5432/' },
    ],
    [
      'known production database name, flag set',
      {
        ...ADMITTED,
        databaseUrl: 'postgresql://user:pw@localhost:5432/miljobeslut',
        declaredDatabaseName: 'miljobeslut',
      },
    ],
    [
      'unknown test database name, flag set',
      {
        ...ADMITTED,
        databaseUrl: 'postgresql://user:pw@localhost:5432/unknown_test_db',
        declaredDatabaseName: 'unknown_test_db',
      },
    ],
    [
      'remote host even for an allowlisted database name',
      { ...ADMITTED, databaseUrl: 'postgresql://user:pw@db.example.com:5432/riskguard_test' },
    ],
    ['allowlisted database but no disposable flag', { ...ADMITTED, disposableFlag: undefined }],
    ['allowlisted database but flag is not 1', { ...ADMITTED, disposableFlag: '0' }],
    ['disposable flag set but GIS_TEST_DB_NAME missing', { ...ADMITTED, declaredDatabaseName: undefined }],
    [
      'GIS_TEST_DB_NAME names a different database than DATABASE_URL',
      { ...ADMITTED, declaredDatabaseName: 'other_test' },
    ],
    // TEST-DB-GUARD (OD-K0-5): clause 7, the explicit opt-in and the live denylist.
    ['TEST-DB-GUARD: no MIMER_TEST_DB_ALLOW opt-in', { ...ADMITTED, optInDatabaseName: undefined }],
    [
      'TEST-DB-GUARD: opt-in names a different database',
      { ...ADMITTED, optInDatabaseName: 'miljobeslut_test' },
    ],
    [
      'TEST-DB-GUARD: the live workstation port 5432, even fully admitted and opted in',
      { ...ADMITTED, databaseUrl: 'postgresql://user:pw@localhost:5432/riskguard_test' },
    ],
    [
      'TEST-DB-GUARD: the prod compose port 5434, even fully admitted and opted in',
      { ...ADMITTED, databaseUrl: 'postgresql://user:pw@127.0.0.1:5434/riskguard_test' },
    ],
    // TEST-DB-GUARD (OD-K0-5, TDG-2 F3): overrides in the query reach other targets than the authority.
    [
      'TEST-DB-GUARD: ?port= overriding the checked port onto the live 5432',
      { ...ADMITTED, databaseUrl: `${ADMITTED_URL}?port=5432` },
    ],
    [
      'TEST-DB-GUARD: ?host= overriding the host onto the live container',
      { ...ADMITTED, databaseUrl: `${ADMITTED_URL}?host=MILJOBESLUT-POSTGRES.` },
    ],
    [
      'TEST-DB-GUARD: ?dbname= naming the live database (libpq)',
      { ...ADMITTED, databaseUrl: `${ADMITTED_URL}?dbname=miljobeslut` },
    ],
  ];

  it.each(rejected)('rejects: %s', (_label, config) => {
    expect(() => assertDisposableGisTestDatabase(config)).toThrow(DisposableGisTestDatabaseError);
  });

  it('admits an allowlisted, explicitly declared, disposable local database', () => {
    const admitted = assertDisposableGisTestDatabase(ADMITTED);
    expect(admitted.databaseName).toBe('riskguard_test');
    expect(admitted.host).toBe('localhost');
  });

  it('a widened allowlist still cannot admit a known production name', () => {
    // Clause ordering proof: production check precedes the allowlist check.
    expect(() =>
      assertDisposableGisTestDatabase({
        ...ADMITTED,
        databaseUrl: 'postgresql://user:pw@localhost:5432/miljobeslut',
        declaredDatabaseName: 'miljobeslut',
      }),
    ).toThrow(/known production database/);
  });
});

describe('destructive path control — zero connection, zero SQL on refusal', () => {
  let workdir: string;
  let cwdSpy: ReturnType<typeof vi.spyOn>;
  const savedEnv = { ...process.env };

  const { connect, query, end } = pgSpies;

  beforeEach(() => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'db0-safety-'));
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(workdir);
    connect.mockReset();
    query.mockReset();
    end.mockReset();
    delete process.env.DATABASE_URL;
    delete process.env.GIS_TEST_DB_DISPOSABLE;
    delete process.env.GIS_TEST_DB_NAME;
    delete process.env.MIMER_TEST_DB_ALLOW;
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

  it('refuses and never connects when .env.test is absent, even if .env names a database', async () => {
    fs.writeFileSync(
      path.join(workdir, '.env'),
      'DATABASE_URL=postgresql://user:pw@localhost:5432/miljobeslut\n',
    );

    await expect(runStubs()).rejects.toThrow(DisposableGisTestDatabaseError);
    expect(connect).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });

  it('refuses and never connects when the environment names a production database', async () => {
    process.env.DATABASE_URL = 'postgresql://user:pw@localhost:5432/miljobeslut';
    process.env.MIMER_TEST_DB_ALLOW = 'miljobeslut';
    fs.writeFileSync(path.join(workdir, '.env.test'), 'GIS_TEST_DB_DISPOSABLE=1\nGIS_TEST_DB_NAME=miljobeslut\n');

    await expect(runStubs()).rejects.toThrow(/known production database/);
    expect(connect).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });

  it('TEST-DB-GUARD: ignores a DATABASE_URL line in .env.test -- the target comes from the environment only', async () => {
    fs.writeFileSync(
      path.join(workdir, '.env.test'),
      `DATABASE_URL=${ADMITTED_URL}\nGIS_TEST_DB_DISPOSABLE=1\nGIS_TEST_DB_NAME=riskguard_test\n`,
    );
    process.env.MIMER_TEST_DB_ALLOW = 'riskguard_test';

    await expect(runStubs()).rejects.toThrow(/DATABASE_URL is missing/);
    expect(connect).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });

  it('TEST-DB-GUARD: refuses and never connects without the MIMER_TEST_DB_ALLOW opt-in', async () => {
    process.env.DATABASE_URL = ADMITTED_URL;
    fs.writeFileSync(path.join(workdir, '.env.test'), 'GIS_TEST_DB_DISPOSABLE=1\nGIS_TEST_DB_NAME=riskguard_test\n');

    await expect(runStubs()).rejects.toThrow(/MIMER_TEST_DB_ALLOW is not set/);
    expect(connect).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });

  it('refuses and never connects when the disposable admission is missing', async () => {
    process.env.DATABASE_URL = ADMITTED_URL;
    process.env.MIMER_TEST_DB_ALLOW = 'riskguard_test';
    fs.writeFileSync(path.join(workdir, '.env.test'), '\n');

    await expect(runStubs()).rejects.toThrow(/GIS_TEST_DB_DISPOSABLE=1 is not set/);
    expect(connect).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });

  it('admits and publishes the checked URL so no other database can be reached', () => {
    process.env.DATABASE_URL = ADMITTED_URL;
    process.env.MIMER_TEST_DB_ALLOW = 'riskguard_test';
    fs.writeFileSync(path.join(workdir, '.env.test'), 'GIS_TEST_DB_DISPOSABLE=1\nGIS_TEST_DB_NAME=riskguard_test\n');

    const admitted = admitDisposableGisTestDatabase();
    expect(admitted.databaseName).toBe('riskguard_test');
    expect(process.env.DATABASE_URL).toBe(admitted.databaseUrl);
  });
});
