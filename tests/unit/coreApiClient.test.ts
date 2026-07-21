import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetCsrfTokenCache } from '../../services/csrfClient';
import { callCore, getToken } from '../../services/coreApiClient';

const TOKEN_KEY = 'miljobeslut_admin_bearer';

function mockLocalStorage(stored: string | null) {
  return {
    getItem: vi.fn((key: string) => (key === TOKEN_KEY ? stored : null)),
    setItem: vi.fn(),
    removeItem: vi.fn(),
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
