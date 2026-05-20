import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../server/createApp';
import { clearSmhiWeatherCache } from '../../server/services/smhiWeatherService';

const app = createApp();

const sampleForecast = {
  approvedTime: '2026-03-17T18:33:07Z',
  referenceTime: '2026-03-17T18:00:00Z',
  timeSeries: [
    {
      validTime: '2026-03-17T19:00:00Z',
      parameters: [
        { name: 't', values: [4.1] },
        { name: 'ws', values: [5.1] },
        { name: 'gust', values: [9.4] },
        { name: 'pmean', values: [0.2] },
        { name: 'pmax', values: [0.4] },
        { name: 'tstm', values: [0] },
        { name: 'Wsymb2', values: [3] },
      ],
    },
  ],
};

describe('SMHI weather endpoint', () => {
  afterEach(() => {
    clearSmhiWeatherCache();
    vi.restoreAllMocks();
  });

  it('returns normalized weather risk from SMHI data', async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify(sampleForecast), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    try {
      const res = await request(app).get(
        '/api/weather/smhi-risk?lat=59.3293&lng=18.0686&municipality=Haninge',
      );

      expect(res.status).toBe(200);
      expect(res.body?.ok).toBe(true);
      expect(res.body?.result?.source).toBe('smhi_pmp3g');
      expect(res.body?.result?.municipality).toBe('Haninge');
      expect(res.body?.result?.coordinates?.lat).toBe(59.3293);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('rejects invalid coordinates before calling SMHI', async () => {
    const fetchMock = vi.fn();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    try {
      const res = await request(app).get('/api/weather/smhi-risk?lat=999&lng=18.0686');

      expect(res.status).toBe(400);
      expect(res.body?.ok).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
