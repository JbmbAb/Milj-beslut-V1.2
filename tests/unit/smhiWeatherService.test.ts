import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearSmhiWeatherCache,
  getSmhiWeatherRisk,
  summarizeSmhiForecast,
} from '../../server/services/smhiWeatherService';

const sampleForecast = {
  approvedTime: '2026-03-17T18:33:07Z',
  referenceTime: '2026-03-17T18:00:00Z',
  timeSeries: [
    {
      validTime: '2026-03-17T19:00:00Z',
      parameters: [
        { name: 't', values: [3.4] },
        { name: 'ws', values: [8.3] },
        { name: 'gust', values: [14.2] },
        { name: 'pmean', values: [0.7] },
        { name: 'pmax', values: [1.6] },
        { name: 'tstm', values: [12] },
        { name: 'Wsymb2', values: [4] },
      ],
    },
    {
      validTime: '2026-03-17T20:00:00Z',
      parameters: [
        { name: 't', values: [2.9] },
        { name: 'ws', values: [9.4] },
        { name: 'gust', values: [18.6] },
        { name: 'pmean', values: [2.2] },
        { name: 'pmax', values: [3.1] },
        { name: 'tstm', values: [38] },
        { name: 'Wsymb2', values: [8] },
      ],
    },
    {
      validTime: '2026-03-17T21:00:00Z',
      parameters: [
        { name: 't', values: [2.2] },
        { name: 'ws', values: [7.1] },
        { name: 'gust', values: [12.1] },
        { name: 'pmean', values: [1.5] },
        { name: 'pmax', values: [2.0] },
        { name: 'tstm', values: [5] },
        { name: 'Wsymb2', values: [7] },
      ],
    },
  ],
};

describe('smhiWeatherService', () => {
  afterEach(() => {
    clearSmhiWeatherCache();
    vi.restoreAllMocks();
  });

  it('summarizes forecast metrics into a high weather risk', () => {
    const result = summarizeSmhiForecast(sampleForecast, {
      lat: 59.3293,
      lng: 18.0686,
      municipality: 'Haninge',
    });

    expect(result.level).toBe('Hög');
    expect(result.source).toBe('smhi_pmp3g');
    expect(result.summary.airTemperatureC).toBe(3.4);
    expect(result.summary.gustMs).toBe(14.2);
    expect(result.peaks.maxGustMs).toBe(18.6);
    expect(result.peaks.accumulatedPrecipitationMm).toBe(4.4);
    expect(result.timeline).toHaveLength(3);
    expect(result.description).toMatch(/Haninge/i);
  });

  it('caches weather responses per coordinate pair', async () => {
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
      await getSmhiWeatherRisk({ lat: 59.3293, lng: 18.0686, municipality: 'Haninge' });
      await getSmhiWeatherRisk({ lat: 59.3293, lng: 18.0686, municipality: 'Haninge' });

      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
