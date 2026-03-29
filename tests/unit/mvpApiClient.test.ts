import { afterEach, describe, expect, it, vi } from 'vitest';
import { callMvp, getToken } from '../../services/mvpApiClient';

// ─── Constants ────────────────────────────────────────────────────────────────

const DEMO_TOKEN =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJkZW1vLXVzZXItaWQiLCJvcmdhbmlzYXRpb25JZCI6ImNtbTR4dnU5ODAwMDBjdWg0dmowdXN6MDkiLCJiYW5raWRJZCI6ImRlbW8tYmFua2lkIiwicm9sZSI6IkFETUlOIiwidHlwZSI6ImFjY2VzcyIsImp0aSI6ImRlbW8tanRpLTE3NDEyOTQwOTIiLCJpYXQiOjE3NDEyOTQwOTIsImV4cCI6MTgwNDQyMzY5MX0.YiCAlEkfJS0zQH-L_ia9Z95ZwIdDq201hb1OK5ciHHU';

const TOKEN_KEY = 'miljobeslut_admin_bearer';

// ─── Helpers ──────────────────────────────────────────────────────────────────

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
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ─── getToken ─────────────────────────────────────────────────────────────────

describe('getToken', () => {
  it('returns the stored token from localStorage', () => {
    vi.stubGlobal('window', { localStorage: mockLocalStorage('my-stored-token') });
    expect(getToken()).toBe('my-stored-token');
  });

  it('falls back to DEMO_TOKEN when localStorage returns null', () => {
    vi.stubGlobal('window', { localStorage: mockLocalStorage(null) });
    expect(getToken()).toBe(DEMO_TOKEN);
  });

  it('trims whitespace from the token', () => {
    vi.stubGlobal('window', { localStorage: mockLocalStorage('  trimmed  ') });
    expect(getToken()).toBe('trimmed');
  });
});

// ─── callMvp ──────────────────────────────────────────────────────────────────

describe('callMvp', () => {
  it('sends a POST request to the given endpoint by default', async () => {
    vi.stubGlobal('window', { localStorage: mockLocalStorage(null) });
    const fetchMock = vi.fn(async () => jsonResponse({ data: 'ok' }));
    vi.stubGlobal('fetch', fetchMock);

    await callMvp('/api/test');

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/test');
    expect(init.method).toBe('POST');
  });

  it('attaches Authorization header with Bearer token', async () => {
    vi.stubGlobal('window', { localStorage: mockLocalStorage('my-token') });
    const fetchMock = vi.fn(async () => jsonResponse({}));
    vi.stubGlobal('fetch', fetchMock);

    await callMvp('/api/resource');

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer my-token');
  });

  it('serialises body as JSON', async () => {
    vi.stubGlobal('window', { localStorage: mockLocalStorage(null) });
    const fetchMock = vi.fn(async () => jsonResponse({}));
    vi.stubGlobal('fetch', fetchMock);

    await callMvp('/api/save', { body: { foo: 'bar' } });

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.body).toBe(JSON.stringify({ foo: 'bar' }));
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  it('appends query params to the URL', async () => {
    vi.stubGlobal('window', { localStorage: mockLocalStorage(null) });
    const fetchMock = vi.fn(async () => jsonResponse({}));
    vi.stubGlobal('fetch', fetchMock);

    await callMvp('/api/search', { method: 'GET', query: { q: 'test', page: '2' } });

    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toContain('q=test');
    expect(url).toContain('page=2');
  });

  it('omits undefined query values', async () => {
    vi.stubGlobal('window', { localStorage: mockLocalStorage(null) });
    const fetchMock = vi.fn(async () => jsonResponse({}));
    vi.stubGlobal('fetch', fetchMock);

    await callMvp('/api/search', { query: { q: 'hello', extra: undefined } });

    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).not.toContain('extra');
  });

  it('returns JSON response as T', async () => {
    vi.stubGlobal('window', { localStorage: mockLocalStorage(null) });
    const fetchMock = vi.fn(async () => jsonResponse({ id: 42, name: 'Alice' }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await callMvp<{ id: number; name: string }>('/api/user');

    expect(result.id).toBe(42);
    expect(result.name).toBe('Alice');
  });

  it('returns Blob for docx content-type', async () => {
    vi.stubGlobal('window', { localStorage: mockLocalStorage(null) });
    const blobData = new Uint8Array([1, 2, 3]).buffer;
    const fetchMock = vi.fn(
      async () =>
        new Response(blobData, {
          status: 200,
          headers: {
            'Content-Type':
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await callMvp('/api/export');
    expect(result).toBeInstanceOf(Blob);
  });

  it('throws with error message when response is not ok (JSON error)', async () => {
    vi.stubGlobal('window', { localStorage: mockLocalStorage(null) });
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { message: 'Forbidden' } }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(callMvp('/api/secret')).rejects.toThrow(/Forbidden/i);
  });

  it('throws with HTTP status when response body cannot be parsed', async () => {
    vi.stubGlobal('window', { localStorage: mockLocalStorage(null) });
    const fetchMock = vi.fn(
      async () =>
        new Response('bad gateway', { status: 502, headers: { 'Content-Type': 'text/plain' } }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(callMvp('/api/broken')).rejects.toThrow(/502/);
  });
});
