import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import {
  parseBbox,
  getPublicDatasourceSummary,
  runWaterAudit,
  runHeritageAudit,
  runClimateAudit,
  getProtectedAreaLayer,
  getHydroLayer,
} from '../../server/services/publicUiService';
import { prisma } from '../../server/db/prisma';

// Standard mocks
vi.mock('../../server/db/prisma', () => ({
  prisma: {
    $queryRaw: vi.fn(),
    projectMember: { findMany: vi.fn() },
    driverJournal: { findUnique: vi.fn() },
  },
}));

vi.mock('./openDataSourceService', () => ({
  fetchImmediateOpenSources: vi.fn().mockResolvedValue([]),
}));

vi.mock('./transportDispatchService', () => ({
  getDispatchProviderRuntimeStatus: vi.fn().mockReturnValue({}),
}));

vi.mock('./sluService', () => ({
  getSluProductStatus: vi.fn().mockReturnValue([]),
  pingSluProduct: vi.fn().mockResolvedValue({ ok: true }),
}));

// Mock fetch globally
global.fetch = vi.fn();

describe('publicUiService', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  describe('parseBbox', () => {
    it('returns null for empty input', () => {
      expect(parseBbox(null)).toBeNull();
      expect(parseBbox('')).toBeNull();
    });

    it('returns null for malformed strings', () => {
      expect(parseBbox('1,2,3')).toBeNull(); // Only 3 parts
      expect(parseBbox('1,2,3,a')).toBeNull(); // Not a number
    });

    it('returns null if min >= max', () => {
      expect(parseBbox('10,10,5,5')).toBeNull();
    });

    it('returns Bbox object for valid input', () => {
      const result = parseBbox('12.5, 55.6, 13.5, 56.6');
      expect(result).toEqual({ minLng: 12.5, minLat: 55.6, maxLng: 13.5, maxLat: 56.6 });
    });
  });

  describe('GIS Audit Functions (PostgreSQL vs Fallbacks)', () => {
    it('runWaterAudit: uses local_postgis if table exists and has rows', async () => {
      // Mock tableExists and localWaterBodyTableHasRows
      (prisma.$queryRaw as Mock)
        .mockResolvedValueOnce([{ regclass: 'hydro.water_body' }]) // tableExists
        .mockResolvedValueOnce([{ has_rows: true }]) // localWaterBodyTableHasRows
        .mockResolvedValueOnce([{ external_id: 'W1', distance_meters: 10 }]); // search results

      const result = await runWaterAudit(56, 13);
      expect(result.source).toBe('local_postgis');
      expect(result.hits.length).toBe(1);
    });

    it('runWaterAudit: uses viss_open_api if local table missing and API key exists', async () => {
      process.env.VISS_API_KEY = 'test-key';
      (prisma.$queryRaw as Mock).mockResolvedValueOnce([{ regclass: null }]); // tableExists -> false

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ NearbyWaters: [{ Name: 'Lake', EU_CD: 'W1' }] }),
      } as any);

      // Second fetch for risk classification
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify([{ EU_CD: 'W1', RiskSections: [] }]),
      } as any);

      const result = await runWaterAudit(56, 13);
      expect(result.source).toBe('viss_open_api');
      expect(result.hits[0].name).toBe('Lake');
    });

    it('runHeritageAudit: uses raa_live if local table missing', async () => {
      (prisma.$queryRaw as Mock).mockResolvedValueOnce([{ regclass: null }]); // tableExists -> false

      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        text: async () =>
          JSON.stringify({
            features: [
              {
                id: 'H1',
                geometry: { type: 'Point', coordinates: [13, 56] },
                properties: { namn: 'Ancient Site', lamningstyp: 'Ruin' },
              },
            ],
          }),
      } as any);

      const result = await runHeritageAudit(56, 13);
      expect(result.source).toBe('raa_live');
      expect(result.hits[0].name).toBe('Ancient Site');
    });

    it('runClimateAudit: uses msb_live if local table missing', async () => {
      (prisma.$queryRaw as Mock).mockResolvedValueOnce([{ regclass: null }]); // tableExists -> false

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ features: [{}, {}] }),
      } as any);

      const result = await runClimateAudit(56, 13);
      expect(result.source).toBe('msb_live');
      expect(result.hitCount).toBe(2);
      expect(result.isFlooded).toBe(true);
    });
  });

  describe('FeatureCollection Layers', () => {
    it('getProtectedAreaLayer: handles both Bbox and global mode', async () => {
      (prisma.$queryRaw as Mock).mockResolvedValue([
        { nvr_id: '1', geojson: '{"type":"Point","coordinates":[1,2]}' },
      ]);

      const fc = await getProtectedAreaLayer({ minLng: 1, minLat: 1, maxLng: 2, maxLat: 2 });
      expect(fc.features.length).toBe(1);
      const callArgs = vi.mocked(prisma.$queryRaw).mock.calls[0];
      expect((callArgs[0] as unknown as string[]).join('')).toContain('ST_MakeEnvelope');

      const globalFc = await getProtectedAreaLayer(null);
      expect(globalFc.features.length).toBe(1);
    });

    it('getHydroLayer: returns empty if bbox is missing', async () => {
      const result = await getHydroLayer('lakes', null);
      expect(result.features.length).toBe(0);
      expect(result.meta?.source).toBe('unavailable');
    });
  });

  describe('Data Source Summary', () => {
    it('getPublicDatasourceSummary: builds cards and caches result', async () => {
      const summary = await getPublicDatasourceSummary();
      expect(summary.cards.length).toBeGreaterThan(0);
      expect(summary.checkedAt).toBeDefined();

      // Test caching
      const summary2 = await getPublicDatasourceSummary();
      expect(summary2.checkedAt).toBe(summary.checkedAt);

      // Force refresh
      const summary3 = await getPublicDatasourceSummary(true);
      expect(summary3).toBeDefined();
    });

    it('covers complexity and data type resolution', async () => {
      const summary = await getPublicDatasourceSummary(true);
      const bankIdCard = summary.cards.find((c) => c.id === 'bankid');
      if (bankIdCard) {
        expect(bankIdCard.provider).toBe('BankID');
        expect(bankIdCard.dataType).toBe('E-legitimering');
      }
    });
  });
});
