import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ExternalMarketIntelAdapter } from '../../../src/infrastructure/external-market-adapter';

describe('ExternalMarketIntelAdapter', () => {
  let adapter: ExternalMarketIntelAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new ExternalMarketIntelAdapter();
    // Clear environment variable
    delete process.env.MARKET_INTEL_ENDPOINT;
  });

  it('returnerar "not_configured" + tom data utan endpoint (ingen statisk fallback)', async () => {
    const snapshot = await adapter.getSnapshot();
    expect(snapshot.source).toBe('not_configured');
    expect(snapshot.prices.length).toBe(0);
  });

  it('should attempt fetch when endpoint is configured', async () => {
    process.env.MARKET_INTEL_ENDPOINT = 'https://api.test/prices';

    const mockResponse = {
      prices: [{ wasteCode: '123', description: 'Test', unitPrice: 100, trend: 'STABLE' }],
      supply: [],
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    });

    const snapshot = await adapter.getSnapshot();
    expect(snapshot.source).toBe('live');
    expect(snapshot.prices[0].wasteCode).toBe('123');
  });

  it('returnerar "error" + tom data när live-fetch kraschar (ingen fallback)', async () => {
    process.env.MARKET_INTEL_ENDPOINT = 'https://api.test/prices';

    global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

    const snapshot = await adapter.getSnapshot();
    expect(snapshot.source).toBe('error');
    expect(snapshot.prices.length).toBe(0);
  });
});
