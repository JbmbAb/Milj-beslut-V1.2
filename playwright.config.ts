import { mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { defineConfig } from '@playwright/test';
import { loadEnv } from 'vite';
import {
  assertTestDatabaseTargetAllowed,
  parseDatabaseUrlTarget,
} from './server/modules/test-db-guard/testDatabaseTargetPolicy';

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

// U30-A: the server refuses to start without the durable Mimers CAS root (no `.data/mimers`
// fallback any more). ADV-1 rest: that root must also be an EXISTING absolute directory -- it is never
// created implicitly. The harness therefore creates its OWN default test root; a caller-provided
// MIMERS_ROOT is used as given and must already exist.
const callerMimersRoot = trim(process.env.MIMERS_ROOT);
const e2eMimersRoot = callerMimersRoot || path.join(os.tmpdir(), `miljobeslut-e2e-mimers-${localApiPort}`);
if (!callerMimersRoot && !isExternalTarget) mkdirSync(e2eMimersRoot, { recursive: true });

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
  DISPATCH_PROVIDER_MODE: 'TIMOCOM',
  TIMOCOM_API_KEY: 'mock-e2e-timocom-key',
  CORS_ALLOW_ORIGINS: localUiBaseUrl,
  START_WORKERS_IN_PROCESS: 'false',
  // U30-A: the E2E harness names an explicit test root (see e2eMimersRoot above).
  MIMERS_ROOT: e2eMimersRoot,
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
  // TEST-DB-GUARD (OD-K0-5): local E2E writes to the database it is given, so it needs the same
  // explicit opt-in as every other test run: MIMER_TEST_DB_ALLOW=<db> naming a *_test database
  // that is not on a live host/port. A live URL from .env.local or the shell is refused here,
  // before any server is started or reused.
  assertTestDatabaseTargetAllowed(
    parseDatabaseUrlTarget(serverEnv.DATABASE_URL) ?? { host: '', port: 0, database: '' },
    'playwright.config.ts (local E2E DATABASE_URL)',
  );
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
