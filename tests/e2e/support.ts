import {
  expect,
  request as playwrightRequest,
  type APIRequestContext,
  type APIResponse,
  type Page,
} from '@playwright/test';
import { loadEnv } from 'vite';

const testEnv = loadEnv('test', process.cwd(), '');

function trim(value: string | undefined): string {
  return String(value || '').trim();
}

function envValue(name: string): string {
  return trim(process.env[name]) || trim(testEnv[name]);
}

export function getE2EAdminCredentials() {
  return {
    username: envValue('E2E_ADMIN_USERNAME') || envValue('ADMIN_CONSOLE_USERNAME') || 'admin',
    password: envValue('E2E_ADMIN_PASSWORD') || envValue('ADMIN_CONSOLE_PASSWORD') || 'admin',
  };
}

export function getE2EApiBaseUrl(): string {
  return (
    trim(process.env.PLAYWRIGHT_API_BASE_URL) ||
    trim(process.env.PLAYWRIGHT_BASE_URL) ||
    trim(process.env.STAGING_API_BASE_URL) ||
    trim(process.env.STAGING_URL) ||
    `http://127.0.0.1:${trim(process.env.PLAYWRIGHT_LOCAL_API_PORT) || '8787'}`
  );
}

export function isExternalE2E(): boolean {
  return Boolean(trim(process.env.PLAYWRIGHT_BASE_URL) || trim(process.env.STAGING_URL));
}

export async function createApiContext(): Promise<APIRequestContext> {
  return playwrightRequest.newContext({
    baseURL: getE2EApiBaseUrl(),
    extraHTTPHeaders: {
      Accept: 'application/json',
    },
  });
}

/** Hämtar CSRF-token och sätter cookie i samma APIRequestContext (krävs före muterande anrop). */
export async function obtainCsrfToken(api: APIRequestContext): Promise<string> {
  const res = await api.get('/api/csrf-token');
  expect(res.ok(), `csrf-token failed: ${res.status()}`).toBeTruthy();
  const body = (await res.json()) as { csrfToken?: string };
  const token = trim(body.csrfToken);
  expect(token.length).toBeGreaterThan(10);
  return token;
}

/** Headers för skyddade muterande anrop (Bearer + x-csrf-token). */
export async function adminAuthHeaders(
  api: APIRequestContext,
  bearerToken: string,
): Promise<Record<string, string>> {
  const csrf = await obtainCsrfToken(api);
  return {
    Authorization: `Bearer ${bearerToken}`,
    'x-csrf-token': csrf,
  };
}

export async function loginAsAdmin(api: APIRequestContext): Promise<string> {
  const session = await loginAsAdminWithRefresh(api);
  return session.accessToken;
}

export async function loginAsAdminWithRefresh(
  api: APIRequestContext,
): Promise<{ accessToken: string; refreshToken: string }> {
  const creds = getE2EAdminCredentials();
  const csrf = await obtainCsrfToken(api);
  const response = await api.post('/api/admin/auth/login', {
    data: creds,
    headers: { 'x-csrf-token': csrf },
  });

  const responseText = await response.text();
  expect(
    response.ok(),
    `admin login failed with ${response.status()}: ${responseText.slice(0, 500)}`,
  ).toBeTruthy();
  const payload = JSON.parse(responseText) as { accessToken?: string; refreshToken?: string };
  const accessToken = trim(payload.accessToken);
  const refreshToken = trim(payload.refreshToken);
  expect(accessToken.length).toBeGreaterThan(20);
  expect(refreshToken.length).toBeGreaterThan(20);
  return { accessToken, refreshToken };
}

/** Samma id som `scripts/db/seed-test.sql` — gör bootstrap/projektmoduler deterministiska i E2E. */
export const E2E_SEEDED_PROJECT_ID = 'test-project-001';

export async function primeAuthenticatedPage(page: Page, api: APIRequestContext): Promise<void> {
  const session = await loginAsAdminWithRefresh(api);
  await page.addInitScript(() => {
    if ('serviceWorker' in navigator) {
      void navigator.serviceWorker
        .getRegistrations()
        .then((registrations) => registrations.forEach((registration) => registration.unregister()));
    }
  });
  await page.addInitScript(
    (input: { accessToken: string; refreshToken: string; activeProjectId: string }) => {
      window.localStorage.setItem('miljobeslut_admin_bearer', input.accessToken);
      window.localStorage.setItem('miljobeslut_admin_refresh', input.refreshToken);
      window.localStorage.setItem('miljobeslut_admin_project', input.activeProjectId);
    },
    { ...session, activeProjectId: E2E_SEEDED_PROJECT_ID },
  );
}

/** Vänta tills hubben visar efterfrågad modul (bootstrap + aktivt projekt). */
export async function waitForHubModuleReady(page: Page, moduleId: string): Promise<void> {
  const creds = getE2EAdminCredentials();
  const coreButton = page.getByTestId('landing-open-core');
  const moduleCard = page.getByTestId(`landing-open-${moduleId}`);
  const moduleNavFallback =
    moduleId === 'logistik' ? page.getByRole('button', { name: /Logistik schaktmassor/i }) : null;
  const adminLoginButton = page.getByRole('button', { name: /Logga in som administratör/i });

  await expect(page).toHaveTitle(/Milj.*beslut/i);
  const coreVisibleInitially = await coreButton.isVisible().catch(() => false);

  if (!coreVisibleInitially) {
    const adminLoginVisible = await adminLoginButton.isVisible().catch(() => false);
    if (adminLoginVisible) {
      const usernameInput = page
        .getByRole('textbox', { name: /Användarnamn/i })
        .or(page.getByTestId('admin-username-input'));
      if (await usernameInput.isVisible().catch(() => false)) {
        await usernameInput.fill(creds.username);
      }

      const passwordInput = page
        .getByRole('textbox', { name: /Lösenord/i })
        .or(page.getByTestId('admin-password-input'));
      await passwordInput.fill(creds.password);
      await adminLoginButton.click();
    }
  }

  await expect
    .poll(
      async () => {
        const coreVisible = await coreButton.isVisible().catch(() => false);
        const moduleVisible = await moduleCard.isVisible().catch(() => false);
        const moduleNavVisible = moduleNavFallback
          ? await moduleNavFallback.isVisible().catch(() => false)
          : false;
        return coreVisible || moduleVisible || moduleNavVisible;
      },
      {
        timeout: 60_000,
      },
    )
    .toBeTruthy();

  if (await moduleCard.isVisible().catch(() => false)) {
    await expect(moduleCard).toBeVisible({ timeout: 60_000 });

    const readyBadge = moduleCard.getByText('READY', { exact: true });
    if ((await readyBadge.count()) > 0) {
      await expect(readyBadge).toBeVisible({ timeout: 10_000 });
    }
  } else if (moduleNavFallback) {
    await expect(moduleNavFallback).toBeVisible({ timeout: 60_000 });
  }
}

export async function parseJson<T>(response: APIResponse): Promise<T> {
  return (await response.json()) as T;
}
