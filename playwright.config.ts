import { defineConfig } from '@playwright/test';
import { loadEnv } from 'vite';

function trim(value: string | undefined): string {
  return String(value || '').trim();
}

function parsePort(value: string | undefined, fallback: number): number {
  const parsed = Number(trim(value));
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback;
}

const externalBaseUrl = trim(process.env.PLAYWRIGHT_BASE_URL) || trim(process.env.STAGING_URL);
const localApiPort = parsePort(process.env.PLAYWRIGHT_LOCAL_API_PORT, 8787);
const localUiPort = parsePort(process.env.PLAYWRIGHT_LOCAL_UI_PORT, 3200);
const localUiBaseUrl = `http://127.0.0.1:${localUiPort}`;
const isExternalTarget = Boolean(externalBaseUrl);
const forceFreshSetting = trim(process.env.PLAYWRIGHT_FORCE_FRESH_SERVER).toLowerCase();
// Local default should reuse running servers to avoid port churn and cold-start flakes.
const requireFreshLocalServers = forceFreshSetting === '' ? false : forceFreshSetting === 'true';
const testEnv = loadEnv('test', process.cwd(), '');

const geminiApiKey = trim(testEnv.GEMINI_API_KEY) || (process.env.CI ? 'ci-gemini-key' : '');

const serverEnv = {
  NODE_ENV: 'development',
  PORT: String(localApiPort),
  DATABASE_URL:
    trim(process.env.PLAYWRIGHT_DATABASE_URL) ||
    trim(process.env.DATABASE_URL) ||
    trim(testEnv.DATABASE_URL) ||
    'postgresql://miljobeslut:miljobeslut@localhost:5432/miljobeslut_test',
  JWT_ACCESS_SECRET: trim(testEnv.JWT_ACCESS_SECRET) || 'test-access-secret',
  JWT_REFRESH_SECRET: trim(testEnv.JWT_REFRESH_SECRET) || 'test-refresh-secret',
  LANTMATERIET_OPEN_MODE: trim(testEnv.LANTMATERIET_OPEN_MODE) || 'true',
  LANTMATERIET_BASE_URL: trim(testEnv.LANTMATERIET_BASE_URL) || 'https://example.invalid',
  ADMIN_CONSOLE_USERNAME:
    trim(process.env.E2E_ADMIN_USERNAME) || trim(testEnv.ADMIN_CONSOLE_USERNAME) || 'admin',
  ADMIN_CONSOLE_PASSWORD:
    trim(process.env.E2E_ADMIN_PASSWORD) || trim(testEnv.ADMIN_CONSOLE_PASSWORD) || 'admin-test-password',
  ADMIN_ORG_NAME: trim(testEnv.ADMIN_ORG_NAME) || 'Miljöbeslut Test Org',
  ADMIN_ORG_NUMBER: trim(testEnv.ADMIN_ORG_NUMBER) || '999999-0001',
  SLU_API_BASE_URL: trim(testEnv.SLU_API_BASE_URL) || 'https://example.invalid',
  SLU_API_KEY: trim(testEnv.SLU_API_KEY) || 'test-slu-key',
  DISPATCH_PROVIDER_MODE: trim(testEnv.DISPATCH_PROVIDER_MODE) || 'MOCK_FRAKTBORS',
  CORS_ALLOW_ORIGINS: localUiBaseUrl,
  START_WORKERS_IN_PROCESS: 'false',
  DOMSTOL_RSS_ENABLED: 'false',
  DISABLE_DB_RATE_LIMIT: 'true',
  SEARCH_WORKER_ENABLED: 'false',
  VERTEX_PROJECT_ID: trim(testEnv.VERTEX_PROJECT_ID) || 'miljointelligens',
  EXEC_SUMMARY_MOCK_MODE: trim(testEnv.EXEC_SUMMARY_MOCK_MODE) || (process.env.CI ? 'true' : ''),
  ...(geminiApiKey ? { GEMINI_API_KEY: geminiApiKey } : {}),
};

function applyLocalTestProcessEnv(): void {
  // Keep test worker and webServer process aligned to avoid credential/port drift.
  process.env.PLAYWRIGHT_DATABASE_URL = serverEnv.DATABASE_URL;
  process.env.DATABASE_URL = serverEnv.DATABASE_URL;
  process.env.PLAYWRIGHT_LOCAL_API_PORT = String(localApiPort);
  process.env.PLAYWRIGHT_API_BASE_URL = `http://127.0.0.1:${localApiPort}`;
  process.env.E2E_ADMIN_USERNAME = serverEnv.ADMIN_CONSOLE_USERNAME;
  process.env.E2E_ADMIN_PASSWORD = serverEnv.ADMIN_CONSOLE_PASSWORD;
}

if (!isExternalTarget) {
  applyLocalTestProcessEnv();
}

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 180000,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  testIgnore: isExternalTarget ? ['tests/e2e/admin-flow.spec.ts'] : [],
  use: {
    baseURL: externalBaseUrl || localUiBaseUrl,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: isExternalTarget
    ? undefined
    : [
        {
          command: 'npm run dev:server',
          port: localApiPort,
          timeout: 180000,
          reuseExistingServer: !process.env.CI && !requireFreshLocalServers,
          env: serverEnv,
        },
        {
          command: `npm run dev -- --host 127.0.0.1 --port ${localUiPort}`,
          port: localUiPort,
          timeout: 180000,
          reuseExistingServer: !process.env.CI && !requireFreshLocalServers,
          env: {
            ...serverEnv,
            VITE_API_BASE_URL: `http://127.0.0.1:${localApiPort}`,
            VITE_LOGIN_ADMIN_ONLY: 'true',
          },
        },
      ],
});
