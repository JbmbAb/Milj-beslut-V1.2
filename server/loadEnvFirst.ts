import { loadEnvFile } from './loadEnv';
import { installTestDatabaseConnectionGuard } from './modules/test-db-guard/installTestDatabaseConnectionGuard';
import { installTestDataRootWriteGuard } from './modules/test-db-guard/installTestDataRootWriteGuard';
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
}

// Force delete any system-level DATABASE_URL on startup to ensure
// local .env and .env.local file settings take absolute precedence!
// Not in a test runtime: there an explicitly set DATABASE_URL is the only allowed source (and
// loadEnvFile never reads .env.local nor takes database settings from any env file there).
if (!testRuntime) {
  delete process.env.DATABASE_URL;
}

// Säkra att miljövariabler laddas allra först innan några andra moduler importeras (för att undvika ES6 hoisting-problem).
loadEnvFile();
const preserveRuntimeEnv =
  process.env.PRESERVE_RUNTIME_ENV === 'true' ||
  Boolean(process.env.PLAYWRIGHT_LOCAL_API_PORT) ||
  process.env.NODE_ENV === 'test';
loadEnvFile('.env.local', { overrideExisting: !preserveRuntimeEnv });
