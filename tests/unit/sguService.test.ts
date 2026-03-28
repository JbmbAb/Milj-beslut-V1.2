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
});
