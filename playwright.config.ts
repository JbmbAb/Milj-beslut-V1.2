import { defineConfig } from '@playwright/test';
import { ensureDockerDatabaseEndpointDiscovery } from './server/modules/test-db-guard/dockerPublishedDatabaseEndpoints';
import { installTestDatabaseConnectionGuard } from './server/modules/test-db-guard/installTestDatabaseConnectionGuard';
import {
  assertExternalE2eTargetsAreRemote,
  LOCAL_E2E_DEFAULT_API_PORT,
  LOCAL_E2E_DEFAULT_UI_PORT,
  resolveLocalE2eServerPlan,
  type LocalE2eServerPlan,
} from './server/modules/test-db-guard/localE2eServerPolicy';
import {
  createFreshTestCasRoots,
  noteRemovedCasEnv,
  removeInheritedCasEnv,
} from './server/modules/test-db-guard/testCasIsolation';

function trim(value: string | undefined): string {
  return String(value || '').trim();
}

const externalBaseUrl = trim(process.env.PLAYWRIGHT_BASE_URL) || trim(process.env.STAGING_URL);
const isExternalTarget = Boolean(externalBaseUrl);

// TEST-DB-GUARD (OD-K0-5): decided first -- before a directory is created, the process env is
// changed or any server is started (server/modules/test-db-guard/localE2eServerPolicy.ts).
//   - An external target must not be this workstation: it would reuse a running local server,
//     e.g. the demonstrator on the live database. Every external target key is judged, never on
//     a demonstrator port, and its host must resolve to public addresses only (TDG-3 N1: an alias
//     such as localtest.me resolves to 127.0.0.1). The runner and workers are guarded too.
//   - A local run needs MIMER_TEST_DB_ALLOW=<db> naming the *_test database of
//     PLAYWRIGHT_DATABASE_URL / DATABASE_URL, both from the process environment (no env file is
//     read for E2E any more), and always gets fresh servers on ports of its own (never 8787).
//   - Ports published by running non-test Docker containers (the live and staging databases)
//     are denied before anything is decided: discovery runs first.
ensureDockerDatabaseEndpointDiscovery();
if (isExternalTarget) {
  assertExternalE2eTargetsAreRemote(process.env);
  // No server is started, but a worker (tests/e2e/prismaClient.ts) must not reach a database
  // without the opt-in either.
  process.env.MIMER_TEST_MODE = '1';
  installTestDatabaseConnectionGuard();
}
const localPlan: LocalE2eServerPlan | null = isExternalTarget ? null : resolveLocalE2eServerPlan(process.env);

const localApiPort = localPlan ? localPlan.apiPort : LOCAL_E2E_DEFAULT_API_PORT;
const localUiPort = localPlan ? localPlan.uiPort : LOCAL_E2E_DEFAULT_UI_PORT;
const localUiBaseUrl = `http://127.0.0.1:${localUiPort}`;

const geminiApiKey = trim(process.env.GEMINI_API_KEY) || (process.env.CI ? 'ci-gemini-key' : '');

// U30-A: the server refuses to start without the durable Mimers CAS root (no `.data/mimers`
// fallback any more). ADV-1 rest: that root must also be an EXISTING absolute directory -- it is never
// created implicitly.
// TEST-DB-GUARD (OD-K0-5), TDG-3: a test never touches live data, so a CAS setting from the caller's
// shell (MIMERS_ROOT=<the demonstrator's CAS>, MIMERS_*, *_CAS*) is never used: it is removed from
// the runner and the workers -- Playwright starts both servers with { ...process.env, ...env } --
// and the API server gets a FRESH CAS of this run, a new directory in the temp dir
// (server/modules/test-db-guard/testCasIsolation.ts).
noteRemovedCasEnv(removeInheritedCasEnv(process.env), 'playwright.config.ts');
const e2eCas = localPlan ? createFreshTestCasRoots() : null;

const serverEnv = {
  NODE_ENV: 'development',
  // TEST-DB-GUARD (OD-K0-5): the API server is a marked test process. It keeps exactly the
  // DATABASE_URL below (loadEnvFirst never deletes it), reads no env file at all (no .env, no
  // .env.local), and guards every database connection with the opt-in it is given.
  MIMER_TEST_MODE: '1',
  PORT: String(localApiPort),
  DATABASE_URL: localPlan ? localPlan.databaseUrl : '',
  MIMER_TEST_DB_ALLOW: localPlan ? localPlan.databaseOptIn : '',
  JWT_ACCESS_SECRET: trim(process.env.JWT_ACCESS_SECRET) || 'test-access-secret',
  JWT_REFRESH_SECRET: trim(process.env.JWT_REFRESH_SECRET) || 'test-refresh-secret',
  LANTMATERIET_OPEN_MODE: trim(process.env.LANTMATERIET_OPEN_MODE) || 'true',
  LANTMATERIET_BASE_URL: trim(process.env.LANTMATERIET_BASE_URL) || 'https://example.invalid',
  ADMIN_CONSOLE_USERNAME: trim(process.env.E2E_ADMIN_USERNAME) || 'admin',
  ADMIN_CONSOLE_PASSWORD: trim(process.env.E2E_ADMIN_PASSWORD) || 'admin-test-password',
  ADMIN_ORG_NAME: trim(process.env.ADMIN_ORG_NAME) || 'Miljöbeslut Test Org',
  ADMIN_ORG_NUMBER: trim(process.env.ADMIN_ORG_NUMBER) || '999999-0001',
  SLU_API_BASE_URL: trim(process.env.SLU_API_BASE_URL) || 'https://example.invalid',
  SLU_API_KEY: trim(process.env.SLU_API_KEY) || 'test-slu-key',
  DISPATCH_PROVIDER_MODE: 'TIMOCOM',
  TIMOCOM_API_KEY: 'mock-e2e-timocom-key',
  CORS_ALLOW_ORIGINS: localUiBaseUrl,
  START_WORKERS_IN_PROCESS: 'false',
  // U30-A / TDG-3: the fresh CAS of this run (see e2eCas above), never the caller's.
  MIMERS_ROOT: e2eCas ? e2eCas.mimersRoot : '',
  ADMIN_ROLE_GRANT_CAS_ROOT: e2eCas ? e2eCas.adminRoleGrantCasRoot : '',
  DOMSTOL_RSS_ENABLED: 'false',
  DISABLE_DB_RATE_LIMIT: 'true',
  SEARCH_WORKER_ENABLED: 'false',
  VERTEX_PROJECT_ID: trim(process.env.VERTEX_PROJECT_ID) || 'miljointelligens',
  EXEC_SUMMARY_MOCK_MODE: trim(process.env.EXEC_SUMMARY_MOCK_MODE) || (process.env.CI ? 'true' : ''),
  ...(geminiApiKey ? { GEMINI_API_KEY: geminiApiKey } : {}),
};

function applyLocalTestProcessEnv(plan: LocalE2eServerPlan): void {
  // TEST-DB-GUARD (OD-K0-5): the runner and every worker (they load this config too) are marked
  // test processes and guarded, so tests/e2e/prismaClient.ts can reach the admitted database only.
  process.env.MIMER_TEST_MODE = '1';
  installTestDatabaseConnectionGuard();
  // Keep test worker and webServer process aligned to avoid credential/port drift.
  process.env.PLAYWRIGHT_DATABASE_URL = plan.databaseUrl;
  process.env.DATABASE_URL = plan.databaseUrl;
  process.env.PLAYWRIGHT_LOCAL_API_PORT = String(localApiPort);
  process.env.PLAYWRIGHT_API_BASE_URL = `http://127.0.0.1:${localApiPort}`;
  process.env.E2E_ADMIN_USERNAME = serverEnv.ADMIN_CONSOLE_USERNAME;
  process.env.E2E_ADMIN_PASSWORD = serverEnv.ADMIN_CONSOLE_PASSWORD;
}

if (localPlan) applyLocalTestProcessEnv(localPlan);

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
  // TEST-DB-GUARD (OD-K0-5): never reuse a running server, locally or in CI -- a server already
  // listening on the port is an error, not something to test against.
  webServer: isExternalTarget
    ? undefined
    : [
        {
          command: 'npm run dev:server',
          port: localApiPort,
          timeout: 180000,
          reuseExistingServer: false,
          env: serverEnv,
        },
        {
          command: `npm run dev -- --host 127.0.0.1 --port ${localUiPort}`,
          port: localUiPort,
          timeout: 180000,
          reuseExistingServer: false,
          env: {
            ...serverEnv,
            VITE_API_BASE_URL: `http://127.0.0.1:${localApiPort}`,
            VITE_LOGIN_ADMIN_ONLY: 'true',
          },
        },
      ],
});
