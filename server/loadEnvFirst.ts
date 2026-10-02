import { loadEnvFile } from './loadEnv';
import { isTestRuntime } from './modules/test-db-guard/testDatabaseTargetPolicy';

// TEST-DB-GUARD (OD-K0-5): decided once, before any env file is read.
const testRuntime = isTestRuntime(process.env);

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
