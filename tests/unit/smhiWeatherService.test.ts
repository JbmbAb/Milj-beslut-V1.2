import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearSmhiWeatherCache,
  getSmhiWeatherRisk,
  summarizeSmhiForecast,
} from '../../server/services/smhiWeatherService';

vi.mock('../../server/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

function makeForecast(gustMs: number, precipMmH: number, thunderPct: number) {
  return {
    approvedTime: '2026-03-17T18:33:07Z',
    referenceTime: '2026-03-17T18:00:00Z',
    timeSeries: [
      {
        validTime: '2026-03-17T19:00:00Z',
        parameters: [
          { name: 't', values: [5.0] },
          { name: 'ws', values: [6.0] },
          { name: 'gust', values: [gustMs] },
          { name: 'pmean', values: [precipMmH] },
          { name: 'pmax', values: [precipMmH * 1.5] },
          { name: 'tstm', values: [thunderPct] },
          { name: 'Wsymb2', values: [3] },
        ],
      },
    ],
  };
}

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

  it('returns Medel risk when gust is 12–17 m/s', () => {
    // maxGust = 13, thunder < 15, precip < 2.5 → Medel
    const result = summarizeSmhiForecast(makeForecast(13, 0.5, 8), {
      lat: 59.0,
      lng: 15.0,
      municipality: 'Örebro',
    });

    expect(result.level).toBe('Medel');
    expect(result.action).toContain('kontrollera pumpning');
    expect(result.description).toMatch(/Örebro/i);
  });

  it('returns Låg risk when all metrics are below thresholds', () => {
    // gust=5, precip=0.1, thunder=3 → all below Medel/Hög thresholds
    const result = summarizeSmhiForecast(makeForecast(5, 0.1, 3), {
      lat: 58.0,
      lng: 14.0,
    });

    expect(result.level).toBe('Låg');
    expect(result.action).toContain('Normal arbetsberedning');
  });

  it('uses "för vald plats" when no municipality is provided', () => {
    const result = summarizeSmhiForecast(makeForecast(13, 0.5, 8), {
      lat: 59.0,
      lng: 15.0,
    });

    expect(result.description).toContain('för vald plats');
    expect(result.municipality).toBeUndefined();
  });

  it('throws when timeSeries is empty', () => {
    expect(() => summarizeSmhiForecast({ timeSeries: [] }, { lat: 59.0, lng: 15.0 })).toThrow(
      'SMHI forecast response did not contain any time series data',
    );
  });

  it('throws when SMHI API returns non-ok response', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(
      async () => new Response('Not Found', { status: 404 }),
    ) as unknown as typeof fetch;

    try {
      await expect(getSmhiWeatherRisk({ lat: 59.3293, lng: 18.0686 })).rejects.toThrow(
        'SMHI weather request failed with status 404',
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
