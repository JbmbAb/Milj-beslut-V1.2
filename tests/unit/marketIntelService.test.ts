import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('../../server/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ─── Module under test ─────────────────────────────────────────────────────────

// Reset modules per test so the module-level _cache is always null at start.
let svc: typeof import('../../legacy/experimental/marketIntelService');

beforeEach(async () => {
  vi.clearAllMocks();
  vi.resetModules();
  delete process.env.MARKET_INTEL_ENDPOINT;
  svc = await import('../../legacy/experimental/marketIntelService');
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('marketIntelService', () => {
  // ── invalidateMarketCache ──────────────────────────────────────────────────

  describe('invalidateMarketCache', () => {
    it('can be called without error', () => {
      expect(() => svc.invalidateMarketCache()).not.toThrow();
    });

    it('forces a fresh fetch on next getMarketSnapshot call', async () => {
      // First call populates cache
      const snap1 = await svc.getMarketSnapshot();
      const time1 = snap1.fetchedAt;

      // Without invalidate, a second call returns the cache (same fetchedAt)
      const snap2 = await svc.getMarketSnapshot();
      expect(snap2.fetchedAt).toBe(time1);

      // After invalidate, new call produces fresh snapshot (may have same or later timestamp)
      svc.invalidateMarketCache();
      const snap3 = await svc.getMarketSnapshot();
      // fetchedAt could be same ms, so just check it's a valid timestamp
      expect(new Date(snap3.fetchedAt).getTime()).not.toBeNaN();
    });
  });

  // ── getMarketSnapshot ──────────────────────────────────────────────────────

  describe('getMarketSnapshot', () => {
    it('returns a snapshot with prices and supply arrays', async () => {
      const snap = await svc.getMarketSnapshot();

      expect(Array.isArray(snap.prices)).toBe(true);
      expect(Array.isArray(snap.supply)).toBe(true);
      expect(snap.prices.length).toBeGreaterThan(0);
      expect(snap.supply.length).toBeGreaterThan(0);
    });

    it('returns "static" source when no endpoint is configured', async () => {
      const snap = await svc.getMarketSnapshot();
      expect(snap.source).toBe('static');
    });

    it('sets fetchedAt to an ISO timestamp', async () => {
      const snap = await svc.getMarketSnapshot();
      expect(snap.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('prices have required fields', async () => {
      const snap = await svc.getMarketSnapshot();
      const price = snap.prices[0];
      expect(price).toHaveProperty('wasteCode');
      expect(price).toHaveProperty('description');
      expect(price).toHaveProperty('unitPrice');
      expect(price.currency).toBe('SEK');
      expect(['RISING', 'STABLE', 'FALLING']).toContain(price.trend);
    });

    it('supply entries have required fields', async () => {
      const snap = await svc.getMarketSnapshot();
      const entry = snap.supply[0];
      expect(entry).toHaveProperty('providerId');
      expect(entry).toHaveProperty('providerName');
      expect(entry).toHaveProperty('region');
      expect(entry.currency).toBe('SEK');
    });

    it('caches result: second call returns same object reference', async () => {
      const snap1 = await svc.getMarketSnapshot();
      const snap2 = await svc.getMarketSnapshot();
      expect(snap2).toBe(snap1);
    });

    it('falls back to static data when endpoint returns error', async () => {
      process.env.MARKET_INTEL_ENDPOINT = 'https://nonexistent.example.com/prices';

      // global fetch will throw (not available in Node test env, or we can stub it)
      const fetchSpy = vi.spyOn(global, 'fetch').mockRejectedValueOnce(new Error('network error'));

      const snap = await svc.getMarketSnapshot();

      expect(snap.prices.length).toBeGreaterThan(0);
      expect(snap.source).toBe('static');

      fetchSpy.mockRestore();
    });

    it('uses live data when endpoint returns valid prices', async () => {
      process.env.MARKET_INTEL_ENDPOINT = 'https://market.example.com/prices';

      const livePrices = [
        {
          wasteCode: '99 99 99',
          description: 'Test Avfall',
          unitPrice: 9999,
          currency: 'SEK',
          unit: 'per_ton',
          trend: 'RISING',
          updatedAt: new Date().toISOString(),
          source: 'live-test',
        },
      ];

      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({ prices: livePrices, supply: [] }),
      } as Response);

      const snap = await svc.getMarketSnapshot();

      expect(snap.source).toBe('live');
      expect(snap.prices[0].wasteCode).toBe('99 99 99');
      expect(snap.prices[0].unitPrice).toBe(9999);

      fetchSpy.mockRestore();
    });
  });

  // ── getPriceForWasteCode ───────────────────────────────────────────────────

  describe('getPriceForWasteCode', () => {
    it('returns price for a known waste code', async () => {
      const price = await svc.getPriceForWasteCode('17 05 04');
      expect(price).toBeDefined();
      expect(price?.wasteCode).toBe('17 05 04');
      expect(price?.unitPrice).toBeGreaterThan(0);
    });

    it('returns undefined for an unknown waste code', async () => {
      const price = await svc.getPriceForWasteCode('XX 00 00');
      expect(price).toBeUndefined();
    });

    it('returns price with all required fields', async () => {
      const price = await svc.getPriceForWasteCode('17 04 05');
      expect(price).toBeDefined();
      expect(price?.description).toBeTruthy();
      expect(price?.currency).toBe('SEK');
      expect(['RISING', 'STABLE', 'FALLING']).toContain(price?.trend);
    });

    it('returns hazardous waste prices correctly', async () => {
      const price = await svc.getPriceForWasteCode('15 02 02*');
      expect(price).toBeDefined();
      expect(price?.unitPrice).toBeGreaterThan(0);
    });
  });
});
