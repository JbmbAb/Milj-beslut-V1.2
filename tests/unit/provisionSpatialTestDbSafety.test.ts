import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { DisposableGisTestDatabaseError } from '../setup/disposableGisTestDatabase';
import { resolveProvisionedSpatialTestDatabaseTarget } from '../../scripts/db/provision-spatial-test-db';

// TEST-DB-GUARD (OD-K0-5): 5433 is the documented disposable test DB port; 5432 on this
// workstation is the live container. The opt-in is passed explicitly (it defaults to the
// process environment's MIMER_TEST_DB_ALLOW, never to .env.test).
const ADMITTED_ENV = {
  TEST_DATABASE_URL: 'postgresql://user:pw@localhost:5433/riskguard_test',
  GIS_TEST_DB_DISPOSABLE: '1',
  GIS_TEST_DB_NAME: 'riskguard_test',
};
const OPT_IN = 'riskguard_test';

describe('provision-spatial-test-db destructive target admission', () => {
  it('does not accept DATABASE_URL as a target fallback', () => {
    expect(() =>
      resolveProvisionedSpatialTestDatabaseTarget(
        {
          DATABASE_URL: 'postgresql://user:pw@localhost:5433/riskguard_test',
          GIS_TEST_DB_DISPOSABLE: '1',
          GIS_TEST_DB_NAME: 'riskguard_test',
        },
        true,
        OPT_IN,
      ),
    ).toThrow(DisposableGisTestDatabaseError);
  });

  it.each([
    ['.env.test is absent', ADMITTED_ENV, false, OPT_IN],
    ['TEST_DATABASE_URL is malformed', { ...ADMITTED_ENV, TEST_DATABASE_URL: 'not-a-url' }, true, OPT_IN],
    [
      'TEST_DATABASE_URL targets a non-disposable database',
      { ...ADMITTED_ENV, TEST_DATABASE_URL: 'postgresql://user:pw@localhost:5432/miljobeslut' },
      true,
      OPT_IN,
    ],
    ['TEST-DB-GUARD: no MIMER_TEST_DB_ALLOW opt-in', ADMITTED_ENV, true, ''],
    [
      'TEST-DB-GUARD: the live workstation port 5432, even opted in',
      { ...ADMITTED_ENV, TEST_DATABASE_URL: 'postgresql://user:pw@localhost:5432/riskguard_test' },
      true,
      OPT_IN,
    ],
  ])('rejects %s before any connection is created', (_label, environment, envTestPresent, optIn) => {
    expect(() => resolveProvisionedSpatialTestDatabaseTarget(environment, envTestPresent, optIn)).toThrow(
      DisposableGisTestDatabaseError,
    );
  });

  it('admits only an explicit, independently declared disposable test target', () => {
    expect(resolveProvisionedSpatialTestDatabaseTarget(ADMITTED_ENV, true, OPT_IN)).toMatchObject({
      databaseName: 'riskguard_test',
      databaseUrl: ADMITTED_ENV.TEST_DATABASE_URL,
    });
  });

  it('performs target admission before a database client can be constructed', () => {
    // Control-flow proof for the direct-entry boundary. The preceding tests prove the guard is
    // pure and rejecting; this assertion fixes its position before all Client construction.
    const source = readFileSync(
      resolve(process.cwd(), 'scripts/db/provision-spatial-test-db.ts'),
      'utf8',
    );

    expect(source.lastIndexOf('resolveProvisionedSpatialTestDatabaseTarget(')).toBeLessThan(
      source.indexOf('const adminClient = new Client'),
    );
  });
});
