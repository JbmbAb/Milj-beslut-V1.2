import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import {
  parseBbox,
  getPublicDatasourceSummary,
  runWaterAudit,
  runHeritageAudit,
  runClimateAudit,
  getProtectedAreaLayer,
  getNatura2000Layer,
  getInternationalProtectionLayer,
  getHydroLayer,
  getFloodRiskLayer,
  getSguCoastalErosionLayer,
  getWaterProtectionLayer,
  getTopo10Layer,
  getSguWellLayer,
  getSguPermeabilityLayer,
  getSguGroundwaterMagazineLayer,
  getSguGroundwaterBodyLayer,
} from '../../server/services/publicUiService';
import { prisma } from '../../server/db/prisma';

// Standard mocks
vi.mock('../../server/db/prisma', () => ({
  prisma: {
    $queryRaw: vi.fn(),
    $queryRawUnsafe: vi.fn(),
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
      (prisma.$queryRaw as Mock)
        .mockResolvedValueOnce([{ regclass: 'env.protected_area' }])
        .mockResolvedValueOnce([{ regclass: 'env.natura2000_area' }])
        .mockResolvedValueOnce([
          { nvr_id: '1', source: 'NVR', geojson: '{"type":"Point","coordinates":[1,2]}' },
        ])
        .mockResolvedValueOnce([{ regclass: 'env.protected_area' }])
        .mockResolvedValueOnce([{ regclass: 'env.natura2000_area' }])
        .mockResolvedValueOnce([
          { nvr_id: '1', source: 'NVR', geojson: '{"type":"Point","coordinates":[1,2]}' },
        ]);

      const fc = await getProtectedAreaLayer({ minLng: 1, minLat: 1, maxLng: 2, maxLat: 2 });
      expect(fc.features.length).toBe(1);
      expect(fc.features[0]).toMatchObject({
        id: 'rmf:v1:source:protected-area:NVR:1',
        properties: { feature_ref: 'rmf:v1:source:protected-area:NVR:1' },
      });
      expect(fc.meta).toMatchObject({
        presentation_kind: 'read_model',
        layer_id: 'protected-area',
        provenance_status: 'PARTIAL',
      });
      const sqlTexts = vi
        .mocked(prisma.$queryRaw)
        .mock.calls.map((call) => String((call[0] as unknown as string[]).join('')));
      expect(sqlTexts.some((sql) => sql.includes('ST_MakeEnvelope'))).toBe(true);

      const globalFc = await getProtectedAreaLayer(null);
      expect(globalFc.features.length).toBe(1);
    });

    it('getNatura2000Layer and getInternationalProtectionLayer return filtered feature collections', async () => {
      (prisma.$queryRaw as Mock)
        .mockResolvedValueOnce([{ regclass: 'env.natura2000_area' }])
        .mockResolvedValueOnce([
          {
            nvr_id: 'natura-1',
            name: 'Natura Alfa',
            protection_type: 'Natura 2000 SCI',
            source: 'Natura2000',
            geojson: '{"type":"Polygon","coordinates":[[[15,60],[15.1,60],[15.1,60.1],[15,60.1],[15,60]]]}',
          },
        ])
        .mockResolvedValueOnce([{ regclass: 'env.protected_area' }])
        .mockResolvedValueOnce([
          {
            nvr_id: 'ramsar-1',
            name: 'Ramsar Beta',
            protection_type: 'RAMSAR',
            source: 'NVR',
            geojson: '{"type":"Polygon","coordinates":[[[15,60],[15.1,60],[15.1,60.1],[15,60.1],[15,60]]]}',
          },
        ]);

      const natura = await getNatura2000Layer({ minLng: 14.9, minLat: 59.9, maxLng: 15.2, maxLat: 60.2 });
      const internationalProtection = await getInternationalProtectionLayer({
        minLng: 14.9,
        minLat: 59.9,
        maxLng: 15.2,
        maxLat: 60.2,
      });

      expect(natura.features).toHaveLength(1);
      expect(natura.features[0]?.properties).toMatchObject({
        nvr_id: 'natura-1',
        protection_type: 'Natura 2000 SCI',
        feature_ref: 'rmf:v1:source:natura2000-area:natura2000_area:natura-1',
      });
      expect(natura.meta).toMatchObject({
        source: 'local_postgis',
        presentation_kind: 'read_model',
        layer_id: 'natura2000-area',
      });

      expect(internationalProtection.features).toHaveLength(1);
      expect(internationalProtection.features[0]?.properties).toMatchObject({
        nvr_id: 'ramsar-1',
        protection_type: 'RAMSAR',
        feature_ref: 'rmf:v1:source:international-protection:protected_area:ramsar-1',
      });
      expect(internationalProtection.meta).toMatchObject({
        source: 'local_postgis',
        presentation_kind: 'read_model',
        layer_id: 'international-protection',
      });
    });

    it('getHydroLayer: returns empty if bbox is missing', async () => {
      const result = await getHydroLayer('lakes', null);
      expect(result.features.length).toBe(0);
      expect(result.meta?.source).toBe('unavailable');
    });

    it('getFloodRiskLayer: returns empty if bbox is missing', async () => {
      const result = await getFloodRiskLayer(null);
      expect(result.features.length).toBe(0);
      expect(result.meta?.source).toBe('unavailable');
    });

    it('getWaterProtectionLayer: returns empty if bbox is missing', async () => {
      const result = await getWaterProtectionLayer(null);
      expect(result.features.length).toBe(0);
      expect(result.meta?.source).toBe('unavailable');
    });

    it('getTopo10Layer: maps frontend aliases like buildings to the correct table', async () => {
      (prisma.$queryRawUnsafe as Mock).mockResolvedValue([
        {
          feature_ref: 'topo10:byggnad:sha256:feature-1',
          source_object_id: 'topo-1',
          source_part_key: '42',
          identity_scope: 'sha256:admitted-bytes',
          identity_version: 'V1',
          category: 'byggnad',
          governance_admission_artifact_id: 'legacy-admission-1',
          source_registry_artifact_id: 'reg-lantmateriet-stac-byggnader-001',
          admitted_byte_sha256: 'admitted-bytes',
          admission_mode: 'LEGACY_MASTER_RECONCILIATION_V1',
          historical_acquisition_status: 'UNKNOWN',
          geojson: '{"type":"Point","coordinates":[18,59]}',
        },
      ]);

      const result = await getTopo10Layer({ minLng: 18, minLat: 59, maxLng: 19, maxLat: 60 }, 'buildings');

      expect(result.features).toHaveLength(1);
      expect(result.features[0]).toMatchObject({
        id: 'topo10:byggnad:sha256:feature-1',
        properties: {
          feature_ref: 'topo10:byggnad:sha256:feature-1',
          source_object_id: 'topo-1',
          source_part_key: '42',
          historical_acquisition_status: 'UNKNOWN',
          dataset_version: null,
          source_updated_at: null,
        },
      });
      expect(result.meta).toMatchObject({
        presentation_kind: 'read_model',
        layer_id: 'topo10-building',
        provenance_status: 'GOVERNED_LEGACY_MASTER_RECONCILIATION',
      });
      expect(prisma.$queryRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining('FROM topo10.byggnad'),
        18,
        59,
        19,
        60,
      );
    });

    it('getTopo10Layer: rejects buildings without persisted V1 identity and admission provenance', async () => {
      (prisma.$queryRawUnsafe as Mock).mockResolvedValue([
        { category: 'byggnad', geojson: '{"type":"Point","coordinates":[18,59]}' },
      ]);

      await expect(
        getTopo10Layer({ minLng: 18, minLat: 59, maxLng: 19, maxLat: 60 }, 'buildings'),
      ).rejects.toThrow('TOPO10_BUILDING_READ_MODEL:identity_or_provenance_unavailable');
    });

    it('getTopo10Layer: rejects unknown layer aliases', async () => {
      await expect(
        getTopo10Layer({ minLng: 18, minLat: 59, maxLng: 19, maxLat: 60 }, 'unknown-layer'),
      ).rejects.toThrow('Invalid topo10 table name');
    });

    it('getSguCoastalErosionLayer: skips failing sublayers and returns warning metadata', async () => {
      for (let index = 0; index < 14; index += 1) {
        (prisma.$queryRaw as Mock).mockResolvedValueOnce([{ regclass: `env.table_${index}` }]);
      }
      (prisma.$queryRawUnsafe as Mock)
        .mockResolvedValueOnce([
          {
            layer_key: 'aktiv_erosion',
            layer_label: 'Aktiv erosion',
            geometry_type: 'ST_Point',
            raw_properties: { risk: 'high' },
            geojson: '{"type":"Point","coordinates":[18,59]}',
          },
        ])
        .mockRejectedValueOnce(new Error('relation env.sgu_coastal_erosion_strandmaterial does not exist'))
        .mockResolvedValue([]);

      const result = await getSguCoastalErosionLayer({ minLng: 18, minLat: 59, maxLng: 19, maxLat: 60 }, 100);

      expect(result.features).toHaveLength(1);
      expect(result.meta).toMatchObject({
        source: 'local_postgis',
        available: true,
        failedLayerCount: 1,
      });
      expect(result.meta?.warning).toContain('SGU Stranderosion kust');
      expect(result.meta?.warning).toContain('kunde inte lasas');
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

  describe('runWaterAudit additional branches', () => {
    it('returns unavailable when local table empty and no VISS key', async () => {
      delete process.env.VISS_API_KEY;
      (prisma.$queryRaw as Mock)
        .mockResolvedValueOnce([{ regclass: 'hydro.water_body' }]) // tableExists → true
        .mockResolvedValueOnce([{ has_rows: false }]); // localWaterBodyTableHasRows → false

      const result = await runWaterAudit(56, 13);
      expect(result.source).toBe('unavailable');
      expect(result.sourceAvailable).toBe(false);
      expect(result.manualReviewRequired).toBe(true);
    });

    it('returns unavailable when VISS API throws', async () => {
      process.env.VISS_API_KEY = 'some-key';
      (prisma.$queryRaw as Mock).mockResolvedValueOnce([{ regclass: null }]); // tableExists → false

      vi.mocked(fetch).mockRejectedValueOnce(new Error('VISS timeout'));

      const result = await runWaterAudit(56, 13);
      expect(result.source).toBe('unavailable');
      expect(result.sourceAvailable).toBe(false);
      expect(result.warning).toContain('VISS Open API misslyckades');
    });

    it('returns viss_open_api with no hits when NearbyWaters is empty', async () => {
      process.env.VISS_API_KEY = 'some-key';
      (prisma.$queryRaw as Mock).mockResolvedValueOnce([{ regclass: null }]); // tableExists → false

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ NearbyWaters: [] }),
      } as any);

      const result = await runWaterAudit(56, 13);
      expect(result.source).toBe('viss_open_api');
      expect(result.hits).toHaveLength(0);
      expect(result.hasWaterRisk).toBe(false);
    });
  });

  describe('runHeritageAudit additional branches', () => {
    it('uses local_postgis when culture.heritage_object table exists', async () => {
      (prisma.$queryRaw as Mock)
        .mockResolvedValueOnce([{ regclass: 'culture.heritage_object' }]) // tableExists → true
        .mockResolvedValueOnce([]); // no nearby heritage objects

      const result = await runHeritageAudit(56, 13);
      expect(result.source).toBe('local_postgis');
      expect(result.sourceAvailable).toBe(true);
      expect(result.manualReviewRequired).toBe(false);
    });

    it('returns unavailable when RAA fetch throws', async () => {
      (prisma.$queryRaw as Mock).mockResolvedValueOnce([{ regclass: null }]); // tableExists → false

      vi.mocked(fetch).mockRejectedValue(new Error('RAA unreachable'));

      const result = await runHeritageAudit(56, 13);
      expect(result.source).toBe('unavailable');
      expect(result.sourceAvailable).toBe(false);
      expect(result.warning).toContain('RAA livekontroll misslyckades');
    });
  });

  describe('runClimateAudit additional branches', () => {
    it('uses local_postgis when climate.flood_risk_area table exists', async () => {
      (prisma.$queryRaw as Mock)
        .mockResolvedValueOnce([{ regclass: 'climate.flood_risk_area' }]) // tableExists → true
        .mockResolvedValueOnce([{ external_id: 'F1', source: 'MSB', return_period: '100-ar' }]);

      const result = await runClimateAudit(56, 13);
      expect(result.source).toBe('local_postgis');
      expect(result.isFlooded).toBe(true);
      expect(result.hitCount).toBe(1);
      expect(result.manualReviewRequired).toBe(false);
    });

    it('returns unavailable when MSB fetch throws', async () => {
      (prisma.$queryRaw as Mock).mockResolvedValueOnce([{ regclass: null }]); // tableExists → false

      vi.mocked(fetch).mockRejectedValueOnce(new Error('MSB WFS down'));

      const result = await runClimateAudit(56, 13);
      expect(result.source).toBe('unavailable');
      expect(result.sourceAvailable).toBe(false);
    });
  });

  describe('getFloodRiskLayer additional branches', () => {
    it('uses local flood table when it exists', async () => {
      (prisma.$queryRaw as Mock)
        .mockResolvedValueOnce([{ regclass: 'climate.flood_risk_area' }])
        .mockResolvedValueOnce([
          {
            external_id: 'F1',
            source: 'MSB',
            return_period: '100-ar',
            geojson: '{"type":"Polygon","coordinates":[[[15,60],[15.1,60],[15.1,60.1],[15,60.1],[15,60]]]}',
          },
        ]);

      const result = await getFloodRiskLayer({ minLng: 14.9, minLat: 59.9, maxLng: 15.2, maxLat: 60.2 });
      expect(result.features).toHaveLength(1);
      expect((result.meta as any).source).toBe('local_postgis');
    });

    it('uses msb live fallback when local flood table is missing', async () => {
      (prisma.$queryRaw as Mock).mockResolvedValueOnce([{ regclass: null }]);
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        text: async () =>
          JSON.stringify({
            features: [
              {
                geometry: {
                  type: 'Polygon',
                  coordinates: [
                    [
                      [15, 60],
                      [15.1, 60],
                      [15.1, 60.1],
                      [15, 60.1],
                      [15, 60],
                    ],
                  ],
                },
                properties: { namn: '100-arszon' },
              },
            ],
          }),
      } as any);

      const result = await getFloodRiskLayer({ minLng: 14.9, minLat: 59.9, maxLng: 15.2, maxLat: 60.2 });
      expect(result.features).toHaveLength(1);
      expect((result.meta as any).source).toBe('msb_live');
    });

    it('returns unavailable when msb flood fallback throws', async () => {
      (prisma.$queryRaw as Mock).mockResolvedValueOnce([{ regclass: null }]);
      vi.mocked(fetch).mockRejectedValueOnce(new Error('MSB WFS down'));

      const result = await getFloodRiskLayer({ minLng: 14.9, minLat: 59.9, maxLng: 15.2, maxLat: 60.2 });
      expect(result.features).toHaveLength(0);
      expect((result.meta as any).source).toBe('unavailable');
    });
  });

  describe('getWaterProtectionLayer additional branches', () => {
    it('filters water protection features from protected areas', async () => {
      (prisma.$queryRaw as Mock)
        .mockResolvedValueOnce([{ regclass: 'env.water_protection_area' }])
        .mockResolvedValueOnce([
          {
            id: 'wp-1',
            name: 'Vattenskyddsomrade Test',
            authority: 'Lansstyrelsen',
            source_updated_at: '2024-01-01',
            source: 'water_protection_area',
            geojson: '{"type":"Polygon","coordinates":[[[15,60],[15.1,60],[15.1,60.1],[15,60.1],[15,60]]]}',
          },
        ]);

      const result = await getWaterProtectionLayer({
        minLng: 14.9,
        minLat: 59.9,
        maxLng: 15.2,
        maxLat: 60.2,
      });
      expect(result.features).toHaveLength(1);
      expect(result.features[0]).toMatchObject({
        id: 'rmf:v1:source:water-protection:water_protection_area:wp-1',
      });
      expect(result.meta).toMatchObject({
        source: 'local_postgis',
        presentation_kind: 'read_model',
        layer_id: 'water-protection',
      });
    });
  });

  describe('getHydroLayer additional branches', () => {
    it('uses topo10.vatten for streams when it exists', async () => {
      (prisma.$queryRaw as Mock)
        .mockResolvedValueOnce([{ regclass: 'topo10.vatten' }]) // tableExists → true
        .mockResolvedValueOnce([
          {
            objid: 'S1',
            namn: 'Vattendrag',
            kategori: 'Vattendrag',
            geojson: '{"type":"LineString","coordinates":[[15,60],[15.1,60.1]]}',
          },
        ]);

      const result = await getHydroLayer('streams', {
        minLng: 14.9,
        minLat: 59.9,
        maxLng: 15.2,
        maxLat: 60.2,
      });
      expect(result.features.length).toBeGreaterThan(0);
      expect(result).toMatchObject({
        meta: {
          source: 'topo10.vatten',
          presentation_kind: 'read_model',
          layer_id: 'topo10-stream',
        },
        features: [{ id: 'rmf:v1:source:topo10-stream:topo10.vatten:S1' }],
      });
    });

    it('uses viss.status_sjoar for lakes when it exists', async () => {
      (prisma.$queryRaw as Mock)
        .mockResolvedValueOnce([{ regclass: 'viss.status_sjoar' }])
        .mockResolvedValueOnce([
          {
            objid: 'LW1',
            namn: 'Siljan',
            kategori: 'LW',
            geojson: '{"type":"Polygon","coordinates":[[[15,60],[15.1,60],[15.1,60.1],[15,60]]]}',
          },
        ]);

      const result = await getHydroLayer('lakes', { minLng: 14, minLat: 59, maxLng: 15, maxLat: 60 });
      expect(result.features).toHaveLength(1);
      expect((result.meta as any).source).toBe('viss.status_sjoar');
    });

    it('returns unavailable for lakes when VISS tables missing', async () => {
      (prisma.$queryRaw as Mock)
        .mockResolvedValueOnce([{ regclass: null }]) // status_sjoar missing
        .mockResolvedValueOnce([{ regclass: null }]); // vattenforekomster missing

      const result = await getHydroLayer('lakes', { minLng: 14, minLat: 59, maxLng: 15, maxLat: 60 });
      expect(result.features).toHaveLength(0);
      expect((result.meta as any).source).toBe('unavailable');
      expect((result.meta as any).warning).toContain('VISS');
    });

    it('returns unavailable for streams when topo10.vatten missing', async () => {
      (prisma.$queryRaw as Mock).mockResolvedValueOnce([{ regclass: null }]);

      const result = await getHydroLayer('streams', { minLng: 14, minLat: 59, maxLng: 15, maxLat: 60 });
      expect((result.meta as any).warning).toContain('topo10.vatten');
    });
  });

  describe('QGIS breadth read-model identities', () => {
    const bbox = { minLng: 14.9, minLat: 59.9, maxLng: 15.2, maxLat: 60.2 };
    const point = '{"type":"Point","coordinates":[15,60]}';
    const polygon = '{"type":"Polygon","coordinates":[[[15,60],[15.1,60],[15.1,60.1],[15,60]]]}';

    it('projects SGU source identifiers as stable feature references', async () => {
      (prisma.$queryRaw as Mock)
        .mockResolvedValueOnce([{ regclass: 'env.sgu_well_actual' }])
        .mockResolvedValueOnce([{ brunnsid: 'well-1', geojson: point }])
        .mockResolvedValueOnce([{ regclass: 'env.sgu_permeability' }])
        .mockResolvedValueOnce([{ objectid: 'perm-1', geojson: polygon }])
        .mockResolvedValueOnce([{ regclass: 'env.sgu_groundwater_magazine' }])
        .mockResolvedValueOnce([{ id: 'mag-1', geojson: polygon }])
        .mockResolvedValueOnce([{ regclass: 'env.sgu_groundwater_body' }])
        .mockResolvedValueOnce([{ ms_cd: 'body-1', geojson: polygon }]);

      const collections = [
        await getSguWellLayer(bbox),
        await getSguPermeabilityLayer(bbox),
        await getSguGroundwaterMagazineLayer(bbox),
        await getSguGroundwaterBodyLayer(bbox),
      ];

      expect(collections.map((collection) => collection.features[0]?.id)).toEqual([
        'rmf:v1:source:sgu-well:sgu_well_actual:well-1',
        'rmf:v1:source:sgu-permeability:sgu_permeability:perm-1',
        'rmf:v1:source:sgu-groundwater-magazine:sgu_groundwater_magazine:mag-1',
        'rmf:v1:source:sgu-groundwater-body:sgu_groundwater_body:body-1',
      ]);
      expect(collections.map((collection) => (collection.meta as any).presentation_kind)).toEqual([
        'read_model', 'read_model', 'read_model', 'read_model',
      ]);
    });

    it('does not fabricate a feature reference when an SGU source identifier is absent', async () => {
      (prisma.$queryRaw as Mock)
        .mockResolvedValueOnce([{ regclass: 'env.sgu_well_actual' }])
        .mockResolvedValueOnce([{ brunnsid: null, geojson: point }]);

      const result = await getSguWellLayer(bbox);

      expect(result.features[0]).not.toHaveProperty('id');
      expect(result.features[0]?.properties).not.toHaveProperty('feature_ref');
    });
  });
});
