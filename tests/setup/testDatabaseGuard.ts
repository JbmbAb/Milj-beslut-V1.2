/**
 * TEST-DB-GUARD (OD-K0-5) -- the FIRST setup file of every Vitest project (vitest.config.ts:
 * unit, component, integration, compliance). It runs in each worker before every test file:
 *
 *   1. installs the connection guard: every pg.Client / pg.Pool / Prisma adapter-pg connection is
 *      refused before a socket opens unless its target is explicitly dead (127.0.0.1:1, *.invalid)
 *      or opted in (MIMER_TEST_DB_ALLOW=<database>, <database> ends in _test and is the target);
 *      any socket to a denylisted live endpoint is refused; dotenv never reads a *.local file and
 *      never loads database settings from an env file;
 *   2. refuses to run the test file at all when the environment names a known live/staging
 *      database (name, host or socket on the denylist);
 *   3. marks every process a test starts: MIMER_TEST_MODE=vitest-worker:<this worker's pid> is
 *      inherited by every child (spawn, spawnSync, exec*, fork, execa, and their own children),
 *      including a child whose test strips VITEST and NODE_ENV to run a script "as an operator
 *      would". Such a child is a hermetic test process: it reads no env file at all -- not
 *      `.env.local`, not `.env` -- whatever its working directory, and it is guarded from its
 *      first import of server/loadEnvFirst on. This worker itself keeps the Vitest rule.
 *      A test that builds a child's env from scratch must set MIMER_TEST_MODE=1 itself.
 *
 * Policy and denylist: server/modules/test-db-guard/testDatabaseTargetPolicy.ts. The destructive
 * GIS globalSetup admission (tests/setup/disposableGisTestDatabase.ts) uses the same policy.
 *
 * Tests that legitimately need a real database -- they now require the explicit opt-in and a
 * database that is not on a live host/port (e.g. the documented test DB on localhost:5433):
 *   - project `integration` (tests/integration/**, tests/smoke/**): globalSetup
 *     tests/setup/database.ts + DATABASE_URL, GIS_TEST_DB_DISPOSABLE=1, GIS_TEST_DB_NAME
 *   - project `compliance`: packages/spatial-provider-postgis/tests/{SpatialProviderPostGIS,
 *     LUMagicMomentPostGIS,LUEnforcement,LUMagicMomentE2E.chain}.test.ts (TEST_DATABASE_URL,
 *     falling back to 127.0.0.1:5432 -- which the guard refuses)
 *   - project `component`: tests/components/luWorkspace.magicMoment.e2e.test.tsx (same fallback)
 * Without the opt-in they fail loudly with TestDatabaseTargetRefusedError; they never pass silently
 * and they never reach a live database.
 */
import { installTestDatabaseConnectionGuard } from '../../server/modules/test-db-guard/installTestDatabaseConnectionGuard';
import {
  assertNoKnownLiveDatabaseInEnv,
  isHermeticTestProcess,
  TEST_MODE_ENV,
  vitestWorkerTestModeMarker,
} from '../../server/modules/test-db-guard/testDatabaseTargetPolicy';

installTestDatabaseConnectionGuard();
assertNoKnownLiveDatabaseInEnv(process.env, 'Vitest setup (tests/setup/testDatabaseGuard.ts)');

// An explicit MIMER_TEST_MODE=1 from the caller (stricter: this worker is hermetic too) is kept.
if (!isHermeticTestProcess(process.env)) {
  process.env[TEST_MODE_ENV] = vitestWorkerTestModeMarker(process.pid);
}
