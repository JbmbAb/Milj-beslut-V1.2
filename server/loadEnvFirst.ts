import { loadEnvFile } from './loadEnv';

const preserveIncomingDatabaseUrl =
  process.env.PRESERVE_RUNTIME_ENV === 'true' ||
  Boolean(process.env.PLAYWRIGHT_LOCAL_API_PORT);

const preserveRuntimeEnv =
  preserveIncomingDatabaseUrl ||
  process.env.NODE_ENV === 'test';

// Force delete any system-level DATABASE_URL on ordinary startup to ensure
// local .env and .env.local file settings take absolute precedence. Fresh
// verifier child processes set PRESERVE_RUNTIME_ENV so their caller-selected
// production DB and public-key env survive this module.
if (!preserveIncomingDatabaseUrl) {
  delete process.env.DATABASE_URL;
}

// Säkra att miljövariabler laddas allra först innan några andra moduler importeras (för att undvika ES6 hoisting-problem).
loadEnvFile();
loadEnvFile('.env.local', { overrideExisting: !preserveRuntimeEnv });
