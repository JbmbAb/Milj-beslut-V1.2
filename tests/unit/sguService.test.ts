import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loggerError: vi.fn(),
}));

vi.mock('../../server/logger', () => ({
  logger: {
    error: mocks.loggerError,
  },
}));

import { fetchGeologicalData } from '../../server/services/sguService';

describe('sguService', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('combines jordarter and vulnerability responses into geological summaries', async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          features: [
            {
              properties: {
                jordnamn: 'Sandig moran',
              },
            },
          ],
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          features: [
            {
              properties: {
                klass_namn: 'H\u00f6g',
              },
            },
          ],
        }),
      } as Response);

    const result = await fetchGeologicalData(60.14, 15.2);

    expect(result).toMatchObject({
      soilType: 'Sandig moran',
      groundwaterVulnerability: 'H\u00f6g',
    });
    expect(result.riskDescription).toContain('H\u00f6g risk');
    expect(vi.mocked(global.fetch)).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('jordarter-25-100-tusen/collections/jordarter/items?bbox='),
    );
    expect(vi.mocked(global.fetch)).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('sarbarhet-grundvatten/collections/sarbarhet/items?bbox='),
    );
  });

  it('logs fetch failures and keeps safe defaults', async () => {
    vi.mocked(global.fetch)
      .mockRejectedValueOnce(new Error('jordarter offline'))
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ features: [] }),
      } as Response);

    const result = await fetchGeologicalData(60.14, 15.2);

    expect(result).toEqual({
      soilType: 'Ok\u00e4nd',
      groundwaterVulnerability: 'Ej bed\u00f6md',
      riskDescription: 'Normala geologiska f\u00f6ruts\u00e4ttningar f\u00f6r omr\u00e5det.',
    });
    expect(mocks.loggerError).toHaveBeenCalledWith('SGU Jordarter fetch failed', {
      err: 'Error: jordarter offline',
    });
  });

  it('keeps safe defaults when features arrays are empty', async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ features: [] }) } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ features: [] }) } as Response);

    const result = await fetchGeologicalData(59.0, 17.0);

    expect(result.soilType).toBe('Ok\u00e4nd');
    expect(result.groundwaterVulnerability).toBe('Ej bed\u00f6md');
    expect(result.riskDescription).toContain('Normala geologiska');
    expect(mocks.loggerError).not.toHaveBeenCalled();
  });

  it('uses fallback property name jordart_namn when jordnamn is missing', async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          features: [{ properties: { jordart_namn: 'Lera' } }],
        }),
      } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ features: [] }) } as Response);

    const result = await fetchGeologicalData(59.0, 17.0);

    expect(result.soilType).toBe('Lera');
  });

  it('logs SGU Sårbarhet error and keeps defaults when sarbarhet fetch throws', async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ features: [] }) } as Response)
      .mockRejectedValueOnce(new Error('sarbarhet timeout'));

    const result = await fetchGeologicalData(59.0, 17.0);

    expect(result.groundwaterVulnerability).toBe('Ej bed\u00f6md');
    expect(mocks.loggerError).toHaveBeenCalledWith('SGU S\u00e5rbarhet fetch failed', {
      err: 'Error: sarbarhet timeout',
    });
  });

  it('uses beskrivning fallback when klass_namn is missing in sarbarhet', async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ features: [] }) } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          features: [{ properties: { beskrivning: 'Medelhög sårbarhet' } }],
        }),
      } as Response);

    const result = await fetchGeologicalData(59.0, 17.0);

    expect(result.groundwaterVulnerability).toBe('Medelhög sårbarhet');
    // riskDescription is derived from soil/geology data, not from the vulnerability label.
    expect(typeof result.riskDescription).toBe('string');
    expect(result.riskDescription.length).toBeGreaterThan(0);
  });

  it('returns Information saknas when both jordnamn and jordart_namn are missing', async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          features: [{ properties: { annanEgenskap: 'ignored' } }],
        }),
      } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ features: [] }) } as Response);

    const result = await fetchGeologicalData(59.0, 17.0);

    expect(result.soilType).toBe('Information saknas');
  });

  it('keeps Ej bedömd when sarbarhet returns ok=false', async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ features: [] }) } as Response)
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'Rate limit' }),
      } as Response);

    const result = await fetchGeologicalData(59.0, 17.0);

    expect(result.groundwaterVulnerability).toBe('Ej bed\u00f6md');
    expect(mocks.loggerError).not.toHaveBeenCalled();
  });
});
