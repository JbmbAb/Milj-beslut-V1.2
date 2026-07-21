import { IMarketIntelProvider, MarketIntelSnapshot, PriceTrend } from '../domain/market-intel';
import { logger } from '../../server/logger';

export class ExternalMarketIntelAdapter implements IMarketIntelProvider {
  private cache: MarketIntelSnapshot | null = null;
  private readonly TTL_MS = 15 * 60 * 1000;

  async getSnapshot(): Promise<MarketIntelSnapshot> {
    if (this.cache && Date.now() - this.cache.fetchedAt.getTime() < this.TTL_MS) {
      return this.cache;
    }

    const endpoint = process.env.MARKET_INTEL_ENDPOINT;
    if (!endpoint) {
      return this.emptySnapshot('not_configured');
    }

    try {
      const response = await fetch(endpoint, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(8000),
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const data = await response.json();
      const snapshot: MarketIntelSnapshot = {
        prices: this.mapPrices(data.prices),
        supply: data.supply || [],
        fetchedAt: new Date(),
        source: 'live',
      };

      this.cache = snapshot;
      return snapshot;
    } catch (error) {
      logger.warn('ExternalMarketIntelAdapter: live fetch failed; no fallback data will be used', { error });
      return this.emptySnapshot('error');
    }
  }

  private emptySnapshot(source: 'not_configured' | 'error'): MarketIntelSnapshot {
    return {
      prices: [],
      supply: [],
      fetchedAt: new Date(),
      source,
    };
  }

  private mapPrices(prices: any[]): any[] {
    if (!Array.isArray(prices)) return [];
    return prices.map((p) => ({
      ...p,
      updatedAt: p.updatedAt ? new Date(p.updatedAt) : new Date(),
      trend: this.mapTrend(p.trend),
    }));
  }

  private mapTrend(trend: string): PriceTrend {
    switch (trend) {
      case 'RISING':
        return PriceTrend.RISING;
      case 'FALLING':
        return PriceTrend.FALLING;
      default:
        return PriceTrend.STABLE;
    }
  }
}
