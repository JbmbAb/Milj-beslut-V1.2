import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { DisposableGisTestDatabaseError } from '../setup/disposableGisTestDatabase';
import { resolveProvisionedSpatialTestDatabaseTarget } from '../../scripts/db/provision-spatial-test-db';

const ADMITTED_ENV = {
  TEST_DATABASE_URL: 'postgresql://user:pw@localhost:5432/riskguard_test',
  GIS_TEST_DB_DISPOSABLE: '1',
  GIS_TEST_DB_NAME: 'riskguard_test',
};

describe('provision-spatial-test-db destructive target admission', () => {
  it('does not accept DATABASE_URL as a target fallback', () => {
    expect(() =>
      resolveProvisionedSpatialTestDatabaseTarget(
        {
          DATABASE_URL: 'postgresql://user:pw@localhost:5432/riskguard_test',
          GIS_TEST_DB_DISPOSABLE: '1',
          GIS_TEST_DB_NAME: 'riskguard_test',
        },
        true,
      ),
    ).toThrow(DisposableGisTestDatabaseError);
  });

  it.each([
    ['.env.test is absent', ADMITTED_ENV, false],
    ['TEST_DATABASE_URL is malformed', { ...ADMITTED_ENV, TEST_DATABASE_URL: 'not-a-url' }, true],
    [
      'TEST_DATABASE_URL targets a non-disposable database',
      { ...ADMITTED_ENV, TEST_DATABASE_URL: 'postgresql://user:pw@localhost:5432/miljobeslut' },
      true,
    ],
  ])('rejects %s before any connection is created', (_label, environment, envTestPresent) => {
    expect(() => resolveProvisionedSpatialTestDatabaseTarget(environment, envTestPresent)).toThrow(
      DisposableGisTestDatabaseError,
    );
  });

  it('admits only an explicit, independently declared disposable test target', () => {
    expect(resolveProvisionedSpatialTestDatabaseTarget(ADMITTED_ENV, true)).toMatchObject({
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
