import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type TrafikverketModule = typeof import('../../services/trafikverketService');
let svc: TrafikverketModule;

beforeEach(async () => {
  vi.resetModules();
  vi.unstubAllGlobals();
  process.env.TRAFIKVERKET_API_BASE_URL = 'https://api.trafikinfo.trafikverket.se/v2/data.json';
  process.env.TRAFIKVERKET_API_KEY = 'test-api-key-123';
  svc = await import('../../services/trafikverketService');
});

afterEach(() => {
  delete process.env.TRAFIKVERKET_API_BASE_URL;
  delete process.env.TRAFIKVERKET_API_KEY;
  vi.restoreAllMocks();
});

describe('TrafikverketService.getRoadData', () => {
  it('sends a POST request to the configured API_URL', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ RESPONSE: { RESULT: [{ PavementData: [] }] } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await svc.trafikverketService.getRoadData(59.33, 18.06, 500);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.trafikinfo.trafikverket.se/v2/data.json');
    expect(init.method).toBe('POST');
  });

  it('sends correct XML payload including coordinates', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ RESPONSE: { RESULT: [{}] } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await svc.trafikverketService.getRoadData(59.33, 18.06, 500);

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = init.body as string;
    expect(body).toContain('<LOGIN authenticationkey="test-api-key-123" />');
    expect(body).toContain('value="18.06 59.33" radius="500m"');
    expect(body).toContain('<INCLUDE>AADT</INCLUDE>');
  });

  it('returns pending mock data if API key is missing', async () => {
    delete process.env.TRAFIKVERKET_API_KEY;
    // We need to re-import the module because it sets API_KEY at the module level!
    // Wait, since we are doing dynamic import after `process.env.TRAFIKVERKET_API_KEY` delete,
    vi.resetModules();
    const svcWithoutKey = await import('../../services/trafikverketService');

    const data = await svcWithoutKey.trafikverketService.getRoadData(59.33, 18.06);
    expect(data.status).toBe('pending_auth');
    expect(data.mockData).toBeDefined();
  });

  it('throws when the API response status is not ok', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response('Service Unavailable', {
          status: 503,
          headers: { 'Content-Type': 'text/plain' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(svc.trafikverketService.getRoadData(59.33, 18.06)).rejects.toThrow(/503/);
  });
});
