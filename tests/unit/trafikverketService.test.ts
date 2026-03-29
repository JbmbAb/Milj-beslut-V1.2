import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Module under test (dynamically imported to allow env-var injection) ─────

type TrafikverketModule = typeof import('../../services/trafikverketService');
let svc: TrafikverketModule;

beforeEach(async () => {
  vi.resetModules();
  vi.unstubAllGlobals();
  process.env.TRAFIKVERKET_API_BASE_URL = 'https://api.trafikverket.se/v2/data.json';
  process.env.TRAFIKVERKET_API_KEY = 'test-api-key-123';
  svc = await import('../../services/trafikverketService');
});

afterEach(() => {
  delete process.env.TRAFIKVERKET_API_BASE_URL;
  delete process.env.TRAFIKVERKET_API_KEY;
  vi.restoreAllMocks();
});

// ─── fetchTrafikverketData ────────────────────────────────────────────────────

describe('fetchTrafikverketData', () => {
  it('sends a POST request to the configured API_URL', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ RESPONSE: { RESULT: [{ TrainStation: [] }] } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await svc.fetchTrafikverketData('<REQUEST/>');

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.trafikverket.se/v2/data.json');
    expect(init.method).toBe('POST');
  });

  it('sends correct headers including API key', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ RESPONSE: { RESULT: [{}] } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await svc.fetchTrafikverketData('<REQUEST/>');

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('text/xml');
    expect(headers['Trafikverket-Api-Key']).toBe('test-api-key-123');
  });

  it('sends the provided query as request body', async () => {
    const xmlQuery = '<REQUEST><LOGIN authenticationkey="test-api-key-123"/></REQUEST>';
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ RESPONSE: { RESULT: [{}] } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await svc.fetchTrafikverketData(xmlQuery);

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.body).toBe(xmlQuery);
  });

  it('returns the first RESULT element when present', async () => {
    const result = { TrainStation: [{ Name: 'Stockholm C' }] };
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ RESPONSE: { RESULT: [result] } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const data = await svc.fetchTrafikverketData<typeof result>('<REQUEST/>');
    expect(data.TrainStation[0].Name).toBe('Stockholm C');
  });

  it('returns an empty object when RESULT is missing', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const data = await svc.fetchTrafikverketData('<REQUEST/>');
    expect(data).toEqual({});
  });

  it('returns an empty object when RESULT array is empty', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ RESPONSE: { RESULT: [] } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const data = await svc.fetchTrafikverketData('<REQUEST/>');
    expect(data).toEqual({});
  });

  it('throws when the API response status is not ok', async () => {
    const fetchMock = vi.fn(async () =>
      new Response('Service Unavailable', {
        status: 503,
        headers: { 'Content-Type': 'text/plain' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(svc.fetchTrafikverketData('<REQUEST/>')).rejects.toThrow(/503/);
  });

  it('re-throws network errors', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('Network failure');
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(svc.fetchTrafikverketData('<REQUEST/>')).rejects.toThrow(/Network failure/i);
  });
});

// ─── getAllTrainStationsQuery ──────────────────────────────────────────────────

describe('getAllTrainStationsQuery', () => {
  it('is a non-empty XML string', () => {
    expect(typeof svc.getAllTrainStationsQuery).toBe('string');
    expect(svc.getAllTrainStationsQuery.trim().length).toBeGreaterThan(0);
    expect(svc.getAllTrainStationsQuery).toContain('<REQUEST>');
    expect(svc.getAllTrainStationsQuery).toContain('TrainStation');
  });
});
