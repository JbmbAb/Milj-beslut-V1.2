import { loadEnvFile } from './loadEnv';

const preserveRuntimeEnv =
  process.env.PRESERVE_RUNTIME_ENV === 'true' ||
  Boolean(process.env.PLAYWRIGHT_LOCAL_API_PORT) ||
  process.env.NODE_ENV === 'test' ||
  process.env.NODE_ENV === 'production';

// Local development keeps the historical .env/.env.local precedence, while production containers
// must honor provider-injected runtime secrets such as DATABASE_URL.
if (!preserveRuntimeEnv) {
  delete process.env.DATABASE_URL;
}

// Säkra att miljövariabler laddas allra först innan några andra moduler importeras (för att undvika ES6 hoisting-problem).
loadEnvFile();
loadEnvFile('.env.local', { overrideExisting: !preserveRuntimeEnv });
