import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchSmhiWeatherRisk } from '../../services/weatherService';
import type { WeatherRisk } from '../../types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mockWeatherRisk(overrides: Partial<WeatherRisk> = {}): WeatherRisk {
  return {
    level: 'Låg',
    description: 'Inga allvarliga väderproblem',
    action: 'Inga åtgärder krävs',
    source: 'SMHI',
    fetchedAt: '2026-01-01T12:00:00.000Z',
    ...overrides,
  };
}

function successResponse(risk: WeatherRisk) {
  return new Response(JSON.stringify({ ok: true, result: risk }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function errorResponse(message: string, status = 400) {
  return new Response(JSON.stringify({ ok: false, error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ─── fetchSmhiWeatherRisk ─────────────────────────────────────────────────────

describe('fetchSmhiWeatherRisk', () => {
  it('calls the correct endpoint with lat/lng params', async () => {
    const fetchMock = vi.fn(async () => successResponse(mockWeatherRisk()));
    vi.stubGlobal('fetch', fetchMock);

    await fetchSmhiWeatherRisk({ lat: 59.33, lng: 18.06 });

    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toContain('/api/weather/smhi-risk');
    expect(url).toContain('lat=59.33');
    expect(url).toContain('lng=18.06');
  });

  it('includes municipality param when provided', async () => {
    const fetchMock = vi.fn(async () => successResponse(mockWeatherRisk()));
    vi.stubGlobal('fetch', fetchMock);

    await fetchSmhiWeatherRisk({ lat: 57.7, lng: 11.97, municipality: 'Göteborg' });

    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toContain('municipality=G%C3%B6teborg');
  });

  it('does not include municipality param when undefined', async () => {
    const fetchMock = vi.fn(async () => successResponse(mockWeatherRisk()));
    vi.stubGlobal('fetch', fetchMock);

    await fetchSmhiWeatherRisk({ lat: 59, lng: 18 });

    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).not.toContain('municipality');
  });

  it('does not include municipality param for blank string', async () => {
    const fetchMock = vi.fn(async () => successResponse(mockWeatherRisk()));
    vi.stubGlobal('fetch', fetchMock);

    await fetchSmhiWeatherRisk({ lat: 59, lng: 18, municipality: '   ' });

    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).not.toContain('municipality');
  });

  it('returns the WeatherRisk result from the response', async () => {
    const risk = mockWeatherRisk({ level: 'Hög', description: 'Extrem storm' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => successResponse(risk)),
    );

    const result = await fetchSmhiWeatherRisk({ lat: 59.33, lng: 18.06 });

    expect(result.level).toBe('Hög');
    expect(result.description).toBe('Extrem storm');
  });

  it('throws when response status is not ok', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => errorResponse('Internal error', 500)),
    );

    await expect(fetchSmhiWeatherRisk({ lat: 59, lng: 18 })).rejects.toThrow(/Internal error/i);
  });

  it('throws when ok is false in payload', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ ok: false, error: 'Ingen data' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
      ),
    );

    await expect(fetchSmhiWeatherRisk({ lat: 59, lng: 18 })).rejects.toThrow(/Ingen data/i);
  });

  it('throws with status code when response body is not valid JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('bad gateway', {
            status: 502,
            headers: { 'Content-Type': 'text/plain' },
          }),
      ),
    );

    await expect(fetchSmhiWeatherRisk({ lat: 59, lng: 18 })).rejects.toThrow(/502/);
  });

  it('throws when result is missing from payload', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
      ),
    );

    await expect(fetchSmhiWeatherRisk({ lat: 59, lng: 18 })).rejects.toThrow();
  });
});
