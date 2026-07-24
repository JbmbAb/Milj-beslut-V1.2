import { loadEnvFile } from './loadEnv';

// Säkra att miljövariabler laddas allra först innan några andra moduler importeras (för att undvika ES6 hoisting-problem).
loadEnvFile();
const preserveRuntimeEnv =
  process.env.PRESERVE_RUNTIME_ENV === 'true' ||
  Boolean(process.env.PLAYWRIGHT_LOCAL_API_PORT) ||
  process.env.NODE_ENV === 'test';
loadEnvFile('.env.local', { overrideExisting: !preserveRuntimeEnv });
