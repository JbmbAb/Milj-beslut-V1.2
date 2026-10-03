import { loadEnvFile } from './loadEnv';
import { assertProdComposeAcknowledgement } from './modules/runtime-env/prodComposeAcknowledgement';
import { isRuntimeEnvironmentAuthoritative } from './modules/runtime-env/runtimeDatabaseUrl';
import { installTestDatabaseConnectionGuard } from './modules/test-db-guard/installTestDatabaseConnectionGuard';
import { installTestDataRootWriteGuard } from './modules/test-db-guard/installTestDataRootWriteGuard';
import { removeTestRemoteStoreEnv } from './modules/test-db-guard/testDataRootIsolation';
import { isTestRuntime } from './modules/test-db-guard/testDatabaseTargetPolicy';

// TEST-DB-GUARD (OD-K0-5): decided once, before any env file is read.
const testRuntime = isTestRuntime(process.env);

// TEST-DB-GUARD (OD-K0-5): a test runtime (NODE_ENV=test, a Vitest worker, or a process marked
// MIMER_TEST_MODE such as the API server Playwright starts) is guarded from its first import on --
// before any other module of the process can call dotenv or open a database connection.
if (testRuntime) {
  installTestDatabaseConnectionGuard();
  // TDG-4: nor does it write into a live data root of a product tree (storage/, .quarantine/, ...).
  installTestDataRootWriteGuard();
  // TDG-5: and a remote bucket (GCS_DOCUMENTS_BUCKET, BACKUP_S3_BUCKET, *_BUCKET*) never reaches a tested
  // server, however it was started; no env file can bring one back (loadEnv skips data-root keys in tests).
  removeTestRemoteStoreEnv(process.env);
}

// W-U402 (U40-2 point 5, owner Round 20 alt. C): a process started by docker-compose.prod.yml carries its mandatory
// acknowledgement; any value but the exact one refuses here -- the app's first import -- before an env file is read and
// before anything that can reach a database is evaluated. Absent: not started by that file, nothing to check.
assertProdComposeAcknowledgement(process.env);

// W-U402 (U40-2): decided once, on the environment the process was STARTED with, before any env file is read.
const runtimeEnvironmentAuthoritative = isRuntimeEnvironmentAuthoritative(process.env);

// Force delete any system-level DATABASE_URL on startup to ensure
// local .env and .env.local file settings take absolute precedence!
// Not in a test runtime: there an explicitly set DATABASE_URL is the only allowed source (and
// loadEnvFile never reads .env.local nor takes database settings from any env file there).
// W-U402 (U40-2, spec §1.3): nor where the process environment is authoritative (NODE_ENV=production or
// PRESERVE_RUNTIME_ENV=true -- the product composition): there the injected DATABASE_URL is the configuration, and
// deleting it left a container without a database URL (the clients then fell back to localhost:5432).
if (!testRuntime && !runtimeEnvironmentAuthoritative) {
  delete process.env.DATABASE_URL;
}

// Säkra att miljövariabler laddas allra först innan några andra moduler importeras (för att undvika ES6 hoisting-problem).
loadEnvFile();
const preserveRuntimeEnv =
  process.env.PRESERVE_RUNTIME_ENV === 'true' ||
  Boolean(process.env.PLAYWRIGHT_LOCAL_API_PORT) ||
  process.env.NODE_ENV === 'test';
loadEnvFile('.env.local', { overrideExisting: !preserveRuntimeEnv });
