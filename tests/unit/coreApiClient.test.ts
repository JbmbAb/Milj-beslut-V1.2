import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetCsrfTokenCache } from '../../services/csrfClient';
import { callCore, getRefreshToken, getToken, LU_SERVER_MESSAGE_MAX_LENGTH, presentServerErrorMessage } from '../../services/coreApiClient';

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

  it('DEMO M2b: the thrown error keeps the server message and also carries the HTTP status and machine codes', async () => {
    vi.stubGlobal('window', { localStorage: mockLocalStorage(null) });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ csrfToken: 'csrf-123' }))
      .mockResolvedValueOnce(
        jsonResponse(
          {
            ok: false,
            error: 'Projektets lokalisering är ogiltig och kan inte användas. Ingen bedömning görs.',
            code: 'LOCALIZATION_GEOMETRY_CURRENTNESS_FAILED',
            failureClass: 'INVALID_GEOMETRY_HEAD',
            reasonCode: 'LOCALIZATION_GEOMETRY_INVALID_GEOMETRY_HEAD',
          },
          409,
        ),
      );
    vi.stubGlobal('fetch', fetchMock);

    const err = (await callCore('/api/localization/generate-report').catch((e: unknown) => e)) as Error & Record<string, unknown>;
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('Projektets lokalisering är ogiltig och kan inte användas. Ingen bedömning görs.');
    expect(err.status).toBe(409);
    expect(err.code).toBe('LOCALIZATION_GEOMETRY_CURRENTNESS_FAILED');
    expect(err.failureClass).toBe('INVALID_GEOMETRY_HEAD');
    expect(err.reasonCode).toBe('LOCALIZATION_GEOMETRY_INVALID_GEOMETRY_HEAD');
  });

  it('W-M2d item 5: the thrown error carries the server\'s own `retryable` flag (only when it is a boolean)', async () => {
    vi.stubGlobal('window', { localStorage: mockLocalStorage(null) });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ csrfToken: 'csrf-123' }))
      .mockResolvedValueOnce(
        jsonResponse(
          {
            ok: false,
            error: 'Projektets lokaliseringsbyten kunde inte verifieras med systemets verifieringsnyckel.',
            code: 'LOCALIZATION_GEOMETRY_CURRENTNESS_FAILED',
            failureClass: 'VERIFIER_CONFIGURATION',
            reasonCode: 'LOCALIZATION_GEOMETRY_VERIFIER_CONFIGURATION',
            retryable: false,
          },
          503,
        ),
      )
      .mockResolvedValueOnce(jsonResponse({ ok: false, error: 'x', retryable: 'yes' }, 503));
    vi.stubGlobal('fetch', fetchMock);

    const err = (await callCore('/api/localization/p/current-assessment').catch((e: unknown) => e)) as Error & Record<string, unknown>;
    expect(err.status).toBe(503);
    expect(err.retryable).toBe(false);
    const other = (await callCore('/api/localization/p/current-assessment').catch((e: unknown) => e)) as Error & Record<string, unknown>;
    expect('retryable' in other).toBe(false);
  });
});

describe("W-TEXT2 (5; UI1-R2 finding L2): the server's raw error text is capped and checked by form before it becomes Error.message", () => {
  const failing = async (body: unknown, status = 500) => {
    // Several calls in one test: the CSRF token is cached after the first, so reset it or the token response is
    // consumed as the API answer (a 200, no throw).
    resetCsrfTokenCache();
    vi.stubGlobal('window', { localStorage: mockLocalStorage(null) });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(jsonResponse({ csrfToken: 'csrf-123' })).mockResolvedValueOnce(jsonResponse(body, status)),
    );
    return (await callCore('/api/localization/p/current-assessment').catch((e: unknown) => e)) as Error & Record<string, unknown>;
  };
  const NEUTRAL = 'Serverns felmeddelande kan inte visas (HTTP 503, kod ASSESSMENT_READ_ERROR).';

  it('control: a plain Swedish server sentence passes unchanged, with its codes', async () => {
    const text = 'Bedömningen kunde inte läsas ur arkivet (tekniskt fel). Den saknas inte, men kan inte visas nu. Ett nytt försök kan lyckas.';
    const err = await failing({ ok: false, error: text, code: 'ASSESSMENT_READ_ERROR', failureClass: 'READ_ERROR', retryable: true }, 503);
    expect(err.message).toBe(text);
    expect(err.code).toBe('ASSESSMENT_READ_ERROR');
    expect(err.retryable).toBe(true);
  });

  it('control: the exact server texts the UI matches pass unchanged', async () => {
    for (const text of [
      'Not authorized for this project.',
      'Governed LU assessment failed tamper verification.',
      'Governed LU assessment is not bound to this project.',
      'No current governed LU assessment is available for this project.',
      'Governed viewer capability is not configured for this project.',
      'REJECT_LOCALIZATION_PRESENTATION: assessment canonical_body_hash',
      'No canonical project context available: no binding registered',
      'Möjlig Cross-Site Request Forgery attack blockerad. Ogiltig eller saknad CSRF-token.',
      'Rate limit exceeded',
      'Fastighet hittades inte i PostGIS: ORSA STACKMORA 3:12',
      'Projektkontexten kunde inte etableras: projektets bindningsindex är inkonsekvent: indexen visar att en bindning har funnits, men den saknas, är dubblerad eller hör till ett annat projekt (bestående integritetsfel). Ingen ny bindning skapades, eftersom projektet redan kan ha en och en ny då skulle kunna ge det en andra fastighetsrot. Felet är bestående och löses inte av ett nytt försök. Kontakta systemets administratör.',
    ]) {
      const err = await failing({ ok: false, error: text }, 403);
      expect(err.message, text).toBe(text);
    }
  });

  it('a 50 000-character text is cut to the cap and marked as cut', async () => {
    const err = await failing({ ok: false, error: 'x'.repeat(50_000), code: 'ASSESSMENT_READ_ERROR' }, 503);
    expect(LU_SERVER_MESSAGE_MAX_LENGTH).toBeLessThanOrEqual(600);
    expect(err.message.length).toBe(LU_SERVER_MESSAGE_MAX_LENGTH);
    expect(err.message.endsWith('…')).toBe(true);
    expect(err.message.startsWith('xxxx')).toBe(true);
  });

  it.each([
    ['a Windows path', 'ENOENT: no such file or directory, open C:\\mimers\\cas\\objects\\ab\\cd.json'],
    ['a POSIX path', 'EACCES: permission denied, open /var/lib/mimers/cas/objects/ab'],
    ['a UNC path', 'open \\\\fileserver\\mimers\\cas'],
    ['SQL', 'relation "core.property_unit" does not exist'],
    ['a SQL statement', 'error in SELECT designation FROM core.property_unit WHERE id = 1'],
    ['a Prisma invocation', "Invalid `prisma.localizationAssessment.findMany()` invocation: Can't reach database server"],
    ['a host and port', "Can't reach database server at db.internal:5432"],
    ['a stack trace', 'TypeError: Cannot read properties of undefined\n    at readRecord (server/modules/x.ts:12:3)\n    at async handler'],
    ['a connection string', 'connect ECONNREFUSED postgresql://user:secret@127.0.0.1:5432/mimer'],
    ['a URL', 'fetch failed for https://internal.example/api/x'],
    ['a control character', 'Bedömningen\u0007 kunde inte läsas'],
  ])('%s is replaced by a neutral text that names the status and the code; the fields are untouched', async (_label, raw) => {
    const err = await failing({ ok: false, error: raw, code: 'ASSESSMENT_READ_ERROR', failureClass: 'READ_ERROR', retryable: true }, 503);
    expect(err.message).toBe(NEUTRAL);
    expect(err.message).not.toMatch(/[\\/]|5432|prisma|SELECT|secret/i);
    expect(err.status).toBe(503);
    expect(err.code).toBe('ASSESSMENT_READ_ERROR');
    expect(err.failureClass).toBe('READ_ERROR');
    expect(err.retryable).toBe(true);
  });

  it('without a code (or with a code that is no code) the neutral text names the status only; an object error is checked too', async () => {
    const err = await failing({ error: { message: 'open C:\\Users\\x\\secret.json' } }, 500);
    expect(err.message).toBe('Serverns felmeddelande kan inte visas (HTTP 500).');
    const odd = await failing({ ok: false, error: 'open /var/lib/x/y', code: 'c:/not a code' }, 500);
    expect(odd.message).toBe('Serverns felmeddelande kan inte visas (HTTP 500).');
    expect(odd.code).toBe('c:/not a code');
  });

  it('the empty or missing text still falls back to the HTTP status, as before', async () => {
    const err = await failing({ ok: false, error: '' }, 502);
    expect(err.message).toBe('HTTP 502');
  });

  it('presentServerErrorMessage (pure): the forms, the cap, the neutral text', () => {
    expect(presentServerErrorMessage('Ett vanligt fel.', 500, undefined)).toBe('Ett vanligt fel.');
    expect(presentServerErrorMessage('  rad ett\n  rad två  ', 500, undefined)).toBe('rad ett rad två');
    expect(presentServerErrorMessage('open C:\\x\\y', 500, 'ASSESSMENT_READ_ERROR')).toBe('Serverns felmeddelande kan inte visas (HTTP 500, kod ASSESSMENT_READ_ERROR).');
    expect(presentServerErrorMessage('open C:\\x\\y', 404, 42)).toBe('Serverns felmeddelande kan inte visas (HTTP 404).');
    expect(presentServerErrorMessage('a'.repeat(LU_SERVER_MESSAGE_MAX_LENGTH), 500, undefined)).toBe('a'.repeat(LU_SERVER_MESSAGE_MAX_LENGTH));
    expect(presentServerErrorMessage('a'.repeat(LU_SERVER_MESSAGE_MAX_LENGTH + 1), 500, undefined)).toBe(`${'a'.repeat(LU_SERVER_MESSAGE_MAX_LENGTH - 1)}…`);
    // Swedish words with a slash or a colon-digit designation are no path.
    expect(presentServerErrorMessage('Fastigheten och/eller planen 3:12 kl. 10:30', 500, undefined)).toBe('Fastigheten och/eller planen 3:12 kl. 10:30');
  });
});
