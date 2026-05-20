const CSRF_ENDPOINT = '/api/csrf-token';
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

let cachedCsrfToken: string | null = null;

function hasWindow(): boolean {
  return typeof window !== 'undefined';
}

function normalizeMethod(method?: string): string {
  return String(method || 'GET')
    .trim()
    .toUpperCase();
}

export async function getCsrfToken(forceRefresh = false): Promise<string> {
  if (!hasWindow()) {
    return '';
  }

  if (!forceRefresh && cachedCsrfToken) {
    return cachedCsrfToken;
  }

  const response = await fetch(CSRF_ENDPOINT, {
    method: 'GET',
    credentials: 'same-origin',
  });

  if (!response.ok) {
    throw new Error(`Kunde inte hämta CSRF-token (${response.status})`);
  }

  const data = (await response.json()) as { csrfToken?: string };
  const token = String(data?.csrfToken || '').trim();
  if (!token) {
    throw new Error('CSRF-token saknas i svaret från servern.');
  }

  cachedCsrfToken = token;
  return token;
}

export function resetCsrfTokenCache(): void {
  cachedCsrfToken = null;
}

export async function csrfFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const method = normalizeMethod(init.method);
  const headers = new Headers(init.headers || {});

  if (MUTATING_METHODS.has(method)) {
    headers.set('x-csrf-token', await getCsrfToken());
  }

  return fetch(input, {
    ...init,
    method,
    headers,
    credentials: init.credentials ?? 'same-origin',
  });
}
