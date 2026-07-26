/**
 * marketIntelService.ts
 *
 * Marknadsintelligens — realtidsprisdata och utbudslistor för masshantering.
 *
 * Datakällor:
 *   1. MARKET_INTEL_ENDPOINT — konfigurerbar extern pristabell-API
 *
 * Priser anges i SEK per ton och uppdateras med 15 min cache.
 */

import { logger } from '../../../logger';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface MarketPrice {
  wasteCode: string;
  description: string;
  unitPrice: number;
  currency: 'SEK';
  unit: 'per_ton' | 'per_m3' | 'per_unit';
  trend: 'RISING' | 'STABLE' | 'FALLING';
  updatedAt: string;
  source: string;
}

export interface MarketSupplyEntry {
  providerId: string;
  providerName: string;
  region: string;
  availableCapacity: number;
  capacityUnit: 'ton' | 'm3';
  wasteCodesAccepted: string[];
  pricePerTon: number;
  currency: 'SEK';
  contactUrl?: string;
}

export interface MarketIntelSnapshot {
  prices: MarketPrice[];
  supply: MarketSupplyEntry[];
  fetchedAt: string;
  source: 'live' | 'cache' | 'not_configured' | 'error';
}

// ─── Cache ────────────────────────────────────────────────────────────────────

let _cache: MarketIntelSnapshot | null = null;
const CACHE_TTL_MS = 15 * 60 * 1000;

// ─── Service ─────────────────────────────────────────────────────────────────

/**
 * Hämta aktuellt marknadsläge: priser + utbud.
 * Cachas i 15 minuter. Utan livekälla returneras tomt resultat.
 */
export async function getMarketSnapshot(): Promise<MarketIntelSnapshot> {
  if (_cache && Date.now() - new Date(_cache.fetchedAt).getTime() < CACHE_TTL_MS) {
    return _cache;
  }

  const now = new Date().toISOString();
  const endpoint = process.env.MARKET_INTEL_ENDPOINT;
  if (!endpoint) {
    _cache = { prices: [], supply: [], fetchedAt: now, source: 'not_configured' };
    return _cache;
  }

  try {
    const resp = await fetch(endpoint, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(8_000),
    });
    if (resp.ok) {
      const data = (await resp.json()) as Partial<MarketIntelSnapshot>;
      _cache = {
        prices: Array.isArray(data.prices) ? data.prices : [],
        supply: Array.isArray(data.supply) ? data.supply : [],
        fetchedAt: now,
        source: 'live',
      };
      return _cache;
    }
  } catch (err) {
    logger.warn('market-intel: live fetch failed; no fallback data will be used', { err: String(err) });
  }

  _cache = { prices: [], supply: [], fetchedAt: now, source: 'error' };
  return _cache;
}

/**
 * Prissök för ett specifikt avfallsslag.
 */
export async function getPriceForWasteCode(wasteCode: string): Promise<MarketPrice | undefined> {
  const snapshot = await getMarketSnapshot();
  return snapshot.prices.find((p) => p.wasteCode === wasteCode);
}

/**
 * Invalidera cache manuellt (t.ex. vid admin-uppdatering).
 */
export function invalidateMarketCache(): void {
  _cache = null;
}
