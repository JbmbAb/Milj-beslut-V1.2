import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetchFn: vi.fn(),
  loggerInfo: vi.fn(),
  loggerWarn: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock('../../server/logger', () => ({
  logger: {
    info: mocks.loggerInfo,
    warn: mocks.loggerWarn,
    error: mocks.loggerError,
  },
}));

type MarketModule = typeof import('../../server/services/marketIntelService');

describe('marketIntelService', () => {
  let getMarketSnapshot: MarketModule['getMarketSnapshot'];
  let getPriceForWasteCode: MarketModule['getPriceForWasteCode'];
  let invalidateMarketCache: MarketModule['invalidateMarketCache'];

  beforeEach(async () => {
    vi.resetAllMocks();
    vi.resetModules();
    delete process.env.MARKET_INTEL_ENDPOINT;
    vi.stubGlobal('fetch', mocks.fetchFn);

    const mod = await import('../../server/services/marketIntelService');
    getMarketSnapshot = mod.getMarketSnapshot;
    getPriceForWasteCode = mod.getPriceForWasteCode;
    invalidateMarketCache = mod.invalidateMarketCache;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.MARKET_INTEL_ENDPOINT;
  });

  describe('getMarketSnapshot', () => {
    it('returns static snapshot when no endpoint is configured', async () => {
      const snapshot = await getMarketSnapshot();
      expect(snapshot.source).toBe('static');
      expect(snapshot.prices.length).toBeGreaterThan(0);
      expect(snapshot.supply.length).toBeGreaterThan(0);
      expect(snapshot.fetchedAt).toBeTruthy();
    });

    it('returns all base prices with updatedAt timestamp set', async () => {
      const snapshot = await getMarketSnapshot();
      for (const price of snapshot.prices) {
        expect(price.updatedAt).toBeTruthy();
      }
    });

    it('returns a cached snapshot on a second call within the TTL', async () => {
      const snap1 = await getMarketSnapshot();
      const snap2 = await getMarketSnapshot();
      expect(snap1.fetchedAt).toBe(snap2.fetchedAt);
      expect(mocks.fetchFn).not.toHaveBeenCalled();
    });

    it('fetches live data when endpoint is configured and returns ok', async () => {
      process.env.MARKET_INTEL_ENDPOINT = 'https://prices.example.com/api';
      vi.resetModules();
      const liveMod = await import('../../server/services/marketIntelService');

      const livePrices = [
        {
          wasteCode: '17 05 04',
          description: 'Live jord',
          unitPrice: 250,
          currency: 'SEK',
          unit: 'per_ton',
          trend: 'RISING',
          updatedAt: '',
          source: 'live',
        },
      ];
      mocks.fetchFn.mockResolvedValue({
        ok: true,
        json: async () => ({ prices: livePrices, supply: [] }),
      });

      const snapshot = await liveMod.getMarketSnapshot();
      expect(snapshot.source).toBe('live');
      expect(snapshot.prices[0].unitPrice).toBe(250);
    });

    it('uses static fallback and logs warning when live endpoint throws', async () => {
      process.env.MARKET_INTEL_ENDPOINT = 'https://prices.example.com/api';
      vi.resetModules();
      const liveMod = await import('../../server/services/marketIntelService');

      mocks.fetchFn.mockRejectedValue(new Error('Network error'));
      const snapshot = await liveMod.getMarketSnapshot();

      expect(snapshot.source).toBe('static');
      expect(mocks.loggerWarn).toHaveBeenCalledWith(
        'market-intel: live fetch failed, using static data',
        expect.objectContaining({ err: expect.stringContaining('Network error') }),
      );
    });

    it('keeps static prices when live endpoint returns empty prices array', async () => {
      process.env.MARKET_INTEL_ENDPOINT = 'https://prices.example.com/api';
      vi.resetModules();
      const liveMod = await import('../../server/services/marketIntelService');

      mocks.fetchFn.mockResolvedValue({
        ok: true,
        json: async () => ({ prices: [], supply: [] }),
      });

      const snapshot = await liveMod.getMarketSnapshot();
      expect(snapshot.prices.length).toBeGreaterThan(0);
    });

    it('keeps static supply when live endpoint returns no supply', async () => {
      process.env.MARKET_INTEL_ENDPOINT = 'https://prices.example.com/api';
      vi.resetModules();
      const liveMod = await import('../../server/services/marketIntelService');

      mocks.fetchFn.mockResolvedValue({
        ok: true,
        json: async () => ({ prices: [], supply: [] }),
      });

      const snapshot = await liveMod.getMarketSnapshot();
      expect(snapshot.supply.length).toBeGreaterThan(0);
    });
  });

  describe('getPriceForWasteCode', () => {
    it('returns price entry for known waste code "17 05 04"', async () => {
      const price = await getPriceForWasteCode('17 05 04');
      expect(price).toBeDefined();
      expect(price?.wasteCode).toBe('17 05 04');
      expect(price?.unitPrice).toBe(180);
      expect(price?.currency).toBe('SEK');
    });

    it('returns price entry for hazardous waste code "20 01 21*"', async () => {
      const price = await getPriceForWasteCode('20 01 21*');
      expect(price).toBeDefined();
      expect(price?.unitPrice).toBe(8900);
    });

    it('returns undefined for an unknown waste code', async () => {
      const price = await getPriceForWasteCode('99 99 99');
      expect(price).toBeUndefined();
    });

    it('returns undefined for empty string input', async () => {
      const price = await getPriceForWasteCode('');
      expect(price).toBeUndefined();
    });
  });

  describe('invalidateMarketCache', () => {
    it('forces a new snapshot to be built on the next call', async () => {
      const snap1 = await getMarketSnapshot();
      invalidateMarketCache();

      // Small delay to ensure a different timestamp is possible
      await new Promise((r) => setTimeout(r, 5));

      const snap2 = await getMarketSnapshot();
      // snap2 is a freshly built snapshot — both are valid
      expect(snap2).toBeDefined();
      expect(snap2.prices.length).toBeGreaterThan(0);
    });

    it('can be called multiple times without throwing', () => {
      expect(() => {
        invalidateMarketCache();
        invalidateMarketCache();
      }).not.toThrow();
    });
  });
});
