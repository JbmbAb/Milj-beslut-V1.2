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
 *   4. removes every CAS setting inherited from the shell (MIMERS_*, *_CAS* -- e.g. a MIMERS_ROOT
 *      naming the demonstrator's CAS), so neither this worker nor any process a test starts can
 *      write into it; a test that needs a CAS creates its own temp root
 *      (tests/setup/casTestIsolationRoot.ts). TDG-3, server/modules/test-db-guard/testCasIsolation.ts.
 *      TDG-4: the same for EVERY data root (QUARANTINE_ROOT, MASTER_ARCHIVE_ROOT, OUTLOOK_*,
 *      IMPORT_*_ROOT, ADMIN_ROLE_GRANT_CAS_ROOT ... -- the declarative list in
 *      server/modules/test-db-guard/testDataRootIsolation.ts): removed before every test file, and
 *      each key whose unset default is a location (a cwd-relative or absolute live directory) is
 *      set to a path in a NEW temp run directory of this test file instead.
 *   5. TDG-4: installs the data-root write guard -- a write, mkdir, copy, rename or removal inside a
 *      live data root of a product tree (storage/, .quarantine/, .data/, tmp-artifacts/,
 *      tests/fixtures/ ...) is refused with TestDataRootWriteRefusedError before anything happens
 *      (server/modules/test-db-guard/installTestDataRootWriteGuard.ts; reviewed exceptions there).
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
import { installTestDataRootWriteGuard } from '../../server/modules/test-db-guard/installTestDataRootWriteGuard';
import { isolateTestDataRootEnv } from '../../server/modules/test-db-guard/testDataRootIsolation';
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

// Before every test file: no data root of the shell (or of an earlier file) reaches the test; the
// keys with a location default get a fresh temp root of this file (TDG-3 CAS, TDG-4 all roots).
isolateTestDataRootEnv(process.env, 'Vitest setup (tests/setup/testDatabaseGuard.ts)');

// TDG-4: no write lands in a live data root of a product tree (storage/, .quarantine/, .data/,
// tmp-artifacts/, tests/fixtures/ ...) -- whatever cwd the run has; refused before anything happens.
installTestDataRootWriteGuard();
