import {
  expect,
  request as playwrightRequest,
  type APIRequestContext,
  type APIResponse,
} from '@playwright/test';

function trim(value: string | undefined): string {
  return String(value || '').trim();
}

export function getE2EAdminCredentials() {
  return {
    username: trim(process.env.E2E_ADMIN_USERNAME) || trim(process.env.ADMIN_CONSOLE_USERNAME) || 'admin',
    password:
      trim(process.env.E2E_ADMIN_PASSWORD) ||
      trim(process.env.ADMIN_CONSOLE_PASSWORD) ||
      'admin-test-password',
  };
}

export function getE2EApiBaseUrl(): string {
  return (
    trim(process.env.PLAYWRIGHT_API_BASE_URL) ||
    trim(process.env.PLAYWRIGHT_BASE_URL) ||
    trim(process.env.STAGING_API_BASE_URL) ||
    trim(process.env.STAGING_URL) ||
    `http://127.0.0.1:${trim(process.env.PLAYWRIGHT_LOCAL_API_PORT) || '8788'}`
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

export async function loginAsAdmin(api: APIRequestContext): Promise<string> {
  const creds = getE2EAdminCredentials();
  const response = await api.post('/api/admin/auth/login', {
    data: creds,
  });

  expect(response.ok(), `admin login failed with ${response.status()}`).toBeTruthy();
  const payload = (await response.json()) as { accessToken?: string };
  const token = trim(payload.accessToken);
  expect(token.length).toBeGreaterThan(20);
  return token;
}

export async function parseJson<T>(response: APIResponse): Promise<T> {
  return (await response.json()) as T;
}
