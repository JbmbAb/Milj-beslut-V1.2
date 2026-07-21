/**
 * MARKET INTEL DOMAIN
 * Hanterar marknadspriser och utbud för avfallsmassor.
 */

export enum PriceTrend {
  RISING = 'RISING',
  STABLE = 'STABLE',
  FALLING = 'FALLING',
}

export interface MarketPrice {
  wasteCode: string;
  description: string;
  unitPrice: number;
  currency: 'SEK';
  unit: string;
  trend: PriceTrend;
  updatedAt: Date;
  source: string;
}

export interface MarketSupplyEntry {
  providerId: string;
  providerName: string;
  region: string;
  availableCapacity: number;
  capacityUnit: string;
  wasteCodesAccepted: string[];
  pricePerTon: number;
  currency: 'SEK';
  contactUrl?: string;
}

export interface MarketIntelSnapshot {
  prices: MarketPrice[];
  supply: MarketSupplyEntry[];
  fetchedAt: Date;
  source: string;
}

export interface IMarketIntelProvider {
  getSnapshot(): Promise<MarketIntelSnapshot>;
}
