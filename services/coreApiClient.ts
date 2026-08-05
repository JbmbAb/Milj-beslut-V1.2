import { csrfFetch } from './csrfClient';

const TOKEN_KEY = 'miljobeslut_admin_bearer';
const REFRESH_TOKEN_KEY = 'miljobeslut_admin_refresh';
const PROJECT_KEY = 'miljobeslut_admin_project';

type ApiCallOptions = {
  method?: string;
  body?: unknown;
  query?: Record<string, unknown>;
  auth?: boolean;
  headers?: Record<string, string>;
};

function hasWindow(): boolean {
  return typeof window !== 'undefined';
}

export function getToken(): string {
  if (!hasWindow()) return '';
  return String(window.localStorage.getItem(TOKEN_KEY) || '').trim();
}

export function getRefreshToken(): string {
  if (!hasWindow()) return '';
  return String(window.localStorage.getItem(REFRESH_TOKEN_KEY) || '').trim();
}

export function getActiveProjectId(): string {
  if (!hasWindow()) return '';
  return String(window.localStorage.getItem(PROJECT_KEY) || '').trim();
}

export function setActiveProjectId(projectId: string | null | undefined): void {
  if (!hasWindow()) return;
  const normalized = String(projectId || '').trim();
  if (normalized) {
    window.localStorage.setItem(PROJECT_KEY, normalized);
    return;
  }
  window.localStorage.removeItem(PROJECT_KEY);
}

export function setSession(input: {
  accessToken: string;
  refreshToken?: string | null;
  activeProjectId?: string | null;
}): void {
  if (!hasWindow()) return;
  window.localStorage.setItem(TOKEN_KEY, input.accessToken);

  const refreshToken = String(input.refreshToken || '').trim();
  if (refreshToken) {
    window.localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
  } else {
    window.localStorage.removeItem(REFRESH_TOKEN_KEY);
  }

  if (input.activeProjectId !== undefined) {
    setActiveProjectId(input.activeProjectId);
  }
}

export function clearSession(): void {
  if (!hasWindow()) return;
  window.localStorage.removeItem(TOKEN_KEY);
  window.localStorage.removeItem(REFRESH_TOKEN_KEY);
  window.localStorage.removeItem(PROJECT_KEY);
}

function buildUrl(endpoint: string, query?: Record<string, unknown>): string {
  const baseOrigin =
    typeof window !== 'undefined' && typeof window.location?.origin === 'string'
      ? window.location.origin
      : 'http://localhost';
  const url = new URL(endpoint, baseOrigin);

  if (!query) return url.toString();

  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.append(key, String(value));
    }
  });

  return url.toString();
}

export async function callApi<T>(endpoint: string, options: ApiCallOptions = {}): Promise<T> {
  const { method = 'POST', body, query, auth = true, headers: extraHeaders } = options;
  const token = getToken();
  const url = buildUrl(endpoint, query);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(extraHeaders || {}),
  };

  if (auth && token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await csrfFetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    if (response.status === 401) {
      if (typeof window !== 'undefined') {
        clearSession();
        window.location.reload();
      }
    }
    const err = (await response.json().catch(() => ({}))) as {
      error?: string | { message?: string };
      message?: string;
    };
    const raw = err.error;
    const fromError =
      typeof raw === 'string' ? raw : raw && typeof raw === 'object' ? String(raw.message || '') : '';
    const msg = (fromError || err.message || '').trim() || `HTTP ${response.status}`;
    throw new Error(msg);
  }

  const contentType = response.headers.get('content-type');
  if (contentType?.includes('application/json')) {
    return response.json() as Promise<T>;
  }

  if (
    contentType?.includes('application/pdf') ||
    contentType?.includes('application/vnd.openxmlformats-officedocument.wordprocessingml.document') ||
    contentType?.includes('application/octet-stream')
  ) {
    return response.blob() as unknown as Promise<T>;
  }

  return response.text() as unknown as Promise<T>;
}

let refreshInFlight: Promise<{ accessToken: string; refreshToken: string }> | null = null;

export async function refreshAccessSession(): Promise<{ accessToken: string; refreshToken: string }> {
  if (refreshInFlight) {
    return refreshInFlight;
  }

  refreshInFlight = (async () => {
    const refreshToken = getRefreshToken();
    if (!refreshToken) {
      throw new Error('No refresh token available');
    }

    const result = await callApi<{ ok: boolean; accessToken: string; refreshToken: string }>(
      '/api/auth/refresh',
      {
        method: 'POST',
        auth: false,
        body: { refreshToken },
      },
    );

    setSession({
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      activeProjectId: getActiveProjectId() || undefined,
    });

    return {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
    };
  })();

  try {
    return await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}

export async function callCore<T>(endpoint: string, options: ApiCallOptions = {}): Promise<T> {
  return callApi<T>(endpoint, options);
}
