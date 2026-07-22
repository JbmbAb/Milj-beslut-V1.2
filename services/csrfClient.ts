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

// Global window.fetch patch to ensure all API calls receive credentials and CSRF tokens automatically
if (typeof window !== 'undefined' && !(window as any).__csrf_patched__ && (typeof process === 'undefined' || process.env?.NODE_ENV !== 'test')) {
  const originalFetch = window.fetch;

  window.fetch = async function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    let urlString = '';
    if (typeof input === 'string') {
      urlString = input;
    } else if (input instanceof URL) {
      urlString = input.toString();
    } else if (input && typeof input === 'object' && 'url' in input) {
      urlString = (input as Request).url || '';
    }

    const isApiCall = urlString.includes('/api/');

    // Avoid infinite recursion on the CSRF token endpoint itself
    if (urlString.includes('/api/csrf-token')) {
      return originalFetch.call(this, input, init);
    }

    if (isApiCall) {
      const method = String(init?.method || 'GET').trim().toUpperCase();
      const isMutating = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
      const nextInit: RequestInit = init ? { ...init } : {};

      // Force same-origin credentials for all API calls to ensure cookies are sent/received correctly
      if (nextInit.credentials === undefined) {
        nextInit.credentials = 'same-origin';
      }

      if (isMutating) {
        try {
          const token = await getCsrfToken();
          const headers = new Headers(nextInit.headers || {});
          headers.set('x-csrf-token', token);
          nextInit.headers = headers;
        } catch (err) {
          console.error('[CSRF Client Patch Error] Failed to inject CSRF token:', err);
        }
      }

      return originalFetch.call(this, input, nextInit);
    }

    return originalFetch.call(this, input, init);
  };

  (window as any).__csrf_patched__ = true;
}

