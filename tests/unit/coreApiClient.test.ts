import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetCsrfTokenCache } from '../../services/csrfClient';
import { callCore, getRefreshToken, getToken } from '../../services/coreApiClient';

const TOKEN_KEY = 'miljobeslut_admin_bearer';
const REFRESH_TOKEN_KEY = 'miljobeslut_admin_refresh';

function mockLocalStorage(stored: string | null, refreshToken: string | null = null) {
  const values = new Map<string, string>();
  if (stored !== null) values.set(TOKEN_KEY, stored);
  if (refreshToken !== null) values.set(REFRESH_TOKEN_KEY, refreshToken);

  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => values.set(key, value)),
    removeItem: vi.fn((key: string) => values.delete(key)),
    clear: vi.fn(),
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  resetCsrfTokenCache();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('getToken', () => {
  it('returns the stored token from localStorage', () => {
    vi.stubGlobal('window', { localStorage: mockLocalStorage('my-stored-token') });
    expect(getToken()).toBe('my-stored-token');
  });

  it('returns empty string when localStorage returns null', () => {
    vi.stubGlobal('window', { localStorage: mockLocalStorage(null) });
    expect(getToken()).toBe('');
  });

  it('trims whitespace from the token', () => {
    vi.stubGlobal('window', { localStorage: mockLocalStorage('  trimmed  ') });
    expect(getToken()).toBe('trimmed');
  });
});

describe('getRefreshToken', () => {
  it('returns the stored refresh token from localStorage', () => {
    vi.stubGlobal('window', { localStorage: mockLocalStorage(null, 'refresh-token') });
    expect(getRefreshToken()).toBe('refresh-token');
  });
});

describe('callCore', () => {
  it('sends a POST request to the given endpoint by default', async () => {
    vi.stubGlobal('window', { localStorage: mockLocalStorage(null) });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ csrfToken: 'csrf-123' }))
      .mockResolvedValueOnce(jsonResponse({ data: 'ok' }));
    vi.stubGlobal('fetch', fetchMock);

    await callCore('/api/test');

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/csrf-token', {
      method: 'GET',
      credentials: 'same-origin',
    });

    const [url, init] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(url).toBe('http://localhost/api/test');
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('x-csrf-token')).toBe('csrf-123');
  });

  it('attaches Authorization header with Bearer token', async () => {
    vi.stubGlobal('window', { localStorage: mockLocalStorage('my-token') });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ csrfToken: 'csrf-123' }))
      .mockResolvedValueOnce(jsonResponse({}));
    vi.stubGlobal('fetch', fetchMock);

    await callCore('/api/resource');

    const [, init] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer my-token');
  });

  it('serialises body as JSON', async () => {
    vi.stubGlobal('window', { localStorage: mockLocalStorage(null) });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ csrfToken: 'csrf-123' }))
      .mockResolvedValueOnce(jsonResponse({}));
    vi.stubGlobal('fetch', fetchMock);

    await callCore('/api/save', { body: { foo: 'bar' } });

    const [, init] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(init.body).toBe(JSON.stringify({ foo: 'bar' }));
    expect(new Headers(init.headers).get('Content-Type')).toBe('application/json');
  });

  it('appends query params to the URL', async () => {
    vi.stubGlobal('window', { localStorage: mockLocalStorage(null) });
    const fetchMock = vi.fn(async () => jsonResponse({}));
    vi.stubGlobal('fetch', fetchMock);

    await callCore('/api/search', { method: 'GET', query: { q: 'test', page: '2' } });

    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toBe('http://localhost/api/search?q=test&page=2');
  });

  it('omits undefined query values', async () => {
    vi.stubGlobal('window', { localStorage: mockLocalStorage(null) });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ csrfToken: 'csrf-123' }))
      .mockResolvedValueOnce(jsonResponse({}));
    vi.stubGlobal('fetch', fetchMock);

    await callCore('/api/search', { query: { q: 'hello', extra: undefined } });

    const [url] = fetchMock.mock.calls[1] as unknown as [string];
    expect(url).toBe('http://localhost/api/search?q=hello');
  });

  it('returns JSON response as T', async () => {
    vi.stubGlobal('window', { localStorage: mockLocalStorage(null) });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ csrfToken: 'csrf-123' }))
      .mockResolvedValueOnce(jsonResponse({ id: 42, name: 'Alice' }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await callCore<{ id: number; name: string }>('/api/user');

    expect(result.id).toBe(42);
    expect(result.name).toBe('Alice');
  });

  it('returns Blob for docx content-type', async () => {
    vi.stubGlobal('window', { localStorage: mockLocalStorage(null) });
    const blobData = new Uint8Array([1, 2, 3]).buffer;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ csrfToken: 'csrf-123' }))
      .mockResolvedValueOnce(
        new Response(blobData, {
          status: 200,
          headers: {
            'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const result = await callCore('/api/export');
    // Undvik realm-problem med Blob + toBeInstanceOf i vissa Node/Vitest-kombinationer.
    expect(result).toEqual(expect.objectContaining({ size: 3 }));
  });

  it('throws with error message when response is not ok (JSON error)', async () => {
    vi.stubGlobal('window', { localStorage: mockLocalStorage(null) });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ csrfToken: 'csrf-123' }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: 'Forbidden' } }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    await expect(callCore('/api/secret')).rejects.toThrow(/Forbidden/i);
  });

  it('does not clear local session or reload on 401 when refresh is unavailable', async () => {
    const localStorage = mockLocalStorage('expired-access-token');
    const reload = vi.fn();
    vi.stubGlobal('window', { localStorage, location: { origin: 'http://localhost', reload } });
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { message: 'token expired' } }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(callCore('/api/app/bootstrap', { method: 'GET' })).rejects.toThrow(/token expired/i);

    expect(localStorage.removeItem).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it('refreshes access session once and retries authenticated calls after 401', async () => {
    const localStorage = mockLocalStorage('expired-access-token', 'refresh-token');
    vi.stubGlobal('window', { localStorage, location: { origin: 'http://localhost' } });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: 'token expired' } }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ csrfToken: 'csrf-123' }))
      .mockResolvedValueOnce(
        jsonResponse({
          ok: true,
          accessToken: 'fresh-access-token',
          refreshToken: 'fresh-refresh-token',
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ ok: true, data: 'retried' }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await callCore<{ ok: boolean; data: string }>('/api/app/bootstrap', { method: 'GET' });

    expect(result.data).toBe('retried');
    expect(localStorage.setItem).toHaveBeenCalledWith(TOKEN_KEY, 'fresh-access-token');
    expect(localStorage.setItem).toHaveBeenCalledWith(REFRESH_TOKEN_KEY, 'fresh-refresh-token');

    const [, retryInit] = fetchMock.mock.calls[3] as unknown as [string, RequestInit];
    expect(new Headers(retryInit.headers).get('Authorization')).toBe('Bearer fresh-access-token');
  });

  it('throws with HTTP status when response body cannot be parsed', async () => {
    vi.stubGlobal('window', { localStorage: mockLocalStorage(null) });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ csrfToken: 'csrf-123' }))
      .mockResolvedValueOnce(
        new Response('bad gateway', { status: 502, headers: { 'Content-Type': 'text/plain' } }),
      );
    vi.stubGlobal('fetch', fetchMock);

    await expect(callCore('/api/broken')).rejects.toThrow(/502/);
  });
});
