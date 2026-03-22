import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseBbox } from '../../server/services/publicUiService';

const mocks = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  fetchImmediateOpenSources: vi.fn(),
  getDispatchProviderRuntimeStatus: vi.fn(),
  getSluProductStatus: vi.fn(),
  pingSluProduct: vi.fn(),
}));

vi.mock('../../server/db/prisma', () => ({
  prisma: {
    $queryRaw: mocks.queryRaw,
  },
}));

vi.mock('../../server/services/openDataSourceService', () => ({
  fetchImmediateOpenSources: mocks.fetchImmediateOpenSources,
}));

vi.mock('../../server/services/transportDispatchService', () => ({
  getDispatchProviderRuntimeStatus: mocks.getDispatchProviderRuntimeStatus,
}));

vi.mock('../../server/services/sluService', () => ({
  getSluProductStatus: mocks.getSluProductStatus,
  pingSluProduct: mocks.pingSluProduct,
}));

const originalEnv = { ...process.env };

function restoreRelevantEnv() {
  const managedKeys = [
    'BANKID_BASE_URL',
    'BANKID_CERT_PATH',
    'BANKID_KEY_PATH',
    'BANKID_PFX_PATH',
    'LANTMATERIET_CONSUMER_KEY',
    'LANTMATERIET_CONSUMER_SECRET',
    'LANTMATERIET_API_KEY',
    'VISS_API_KEY',
    'VISS_API_BASE_URL',
    'SGU_DB_COVERAGE_MODE',
  ];

  for (const key of managedKeys) {
    const originalValue = originalEnv[key];
    if (originalValue === undefined) delete process.env[key];
    else process.env[key] = originalValue;
  }
}

describe('publicUiService', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-21T12:00:00.000Z'));
    restoreRelevantEnv();

    mocks.fetchImmediateOpenSources.mockResolvedValue([]);
    mocks.queryRaw.mockResolvedValue([]);
    mocks.getDispatchProviderRuntimeStatus.mockReturnValue({
      activeProvider: 'mock',
      credentials: {
        timocomConfigured: false,
        transEuConfigured: false,
      },
    });
    mocks.getSluProductStatus.mockReturnValue([]);
    mocks.pingSluProduct.mockResolvedValue({
      ok: true,
      status: 200,
      endpoint: 'https://slu.test/default',
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        throw new Error(`Unexpected fetch: ${String(input)}`);
      }),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    restoreRelevantEnv();
  });

  it('parses valid bounding boxes and rejects malformed input', () => {
    expect(parseBbox('10, 20, 30, 40')).toEqual({
      minLng: 10,
      minLat: 20,
      maxLng: 30,
      maxLat: 40,
    });
    expect(parseBbox(null)).toBeNull();
    expect(parseBbox('10,20,30')).toBeNull();
    expect(parseBbox('10,foo,30,40')).toBeNull();
    expect(parseBbox('30,20,10,40')).toBeNull();
    expect(parseBbox('10,40,30,20')).toBeNull();
  });

  it('builds datasource cards, preserves dispatch data and reuses cache until refreshed', async () => {
    process.env.BANKID_BASE_URL = 'https://bankid.test';
    process.env.BANKID_CERT_PATH = 'cert.pem';
    process.env.BANKID_KEY_PATH = 'key.pem';
    process.env.LANTMATERIET_CONSUMER_KEY = 'consumer';
    process.env.LANTMATERIET_CONSUMER_SECRET = 'secret';

    mocks.fetchImmediateOpenSources.mockResolvedValueOnce([
      {
        source: 'naturvardsverket',
        ok: true,
        status: 200,
        details: 'healthy',
        endpoint: 'https://nv.test',
      },
      {
        source: 'sgu',
        ok: false,
        status: 503,
        details: 'upstream unavailable',
        endpoint: 'https://sgu.test',
      },
      {
        source: 'smp',
        ok: false,
        status: 401,
        details: 'login required',
        endpoint: 'https://smp.test',
      },
    ]);
    mocks.fetchImmediateOpenSources.mockResolvedValueOnce([
      {
        source: 'naturvardsverket',
        ok: true,
        status: 200,
        details: 'healthy',
        endpoint: 'https://nv.test',
      },
      {
        source: 'sgu',
        ok: true,
        status: 200,
        details: 'healthy again',
        endpoint: 'https://sgu.test',
      },
      {
        source: 'smp',
        ok: false,
        status: 401,
        details: 'login required',
        endpoint: 'https://smp.test',
      },
    ]);
    mocks.getDispatchProviderRuntimeStatus.mockReturnValue({
      activeProvider: 'timocom',
      credentials: {
        timocomConfigured: true,
        transEuConfigured: false,
      },
    });
    mocks.getSluProductStatus.mockReturnValue([
      { product: 'artfakta', hasApiKey: true, hasBasePath: true },
      { product: 'artportalen', hasApiKey: true, hasBasePath: true },
    ]);
    mocks.pingSluProduct.mockImplementation(async (product: string) => ({
      ok: true,
      status: 200,
      endpoint: `https://slu.test/${product}`,
    }));

    const { getPublicDatasourceSummary } = await import('../../server/services/publicUiService');

    const first = await getPublicDatasourceSummary(true);
    const cardsById = new Map(first.cards.map((card) => [card.id, card]));

    expect(first.checkedAt).toBe('2026-03-21T12:00:00.000Z');
    expect(first.dispatch).toEqual({
      activeProvider: 'timocom',
      credentials: {
        timocomConfigured: true,
        transEuConfigured: false,
      },
    });
    expect(cardsById.has('kommun_kontakter_csv')).toBe(false);
    expect(cardsById.has('kommunala_diarier')).toBe(false);
    expect(cardsById.get('bankid')).toMatchObject({
      provider: 'BankID',
      dataType: 'E-legitimering',
      status: 'CONNECTED',
    });
    expect(cardsById.get('lantmateriet_licensed')).toMatchObject({
      provider: 'Lantmateriet',
      status: 'CONNECTED',
    });
    expect(cardsById.get('slu')).toMatchObject({
      provider: 'SLU',
      status: 'CONNECTED',
      endpoint: 'https://slu.test/artfakta',
    });
    expect(cardsById.get('naturvardsverket')).toMatchObject({
      status: 'CONNECTED',
      reason: 'Livecheck OK (200)',
      endpoint: 'https://nv.test',
    });
    expect(cardsById.get('sgu')).toMatchObject({
      status: 'ERROR',
      reason: 'upstream unavailable',
      endpoint: 'https://sgu.test',
    });
    expect(cardsById.get('smp')).toMatchObject({
      status: 'DISCONNECTED',
      dataType: 'Portal',
    });

    vi.setSystemTime(new Date('2026-03-21T12:03:00.000Z'));
    const cached = await getPublicDatasourceSummary();

    expect(cached).toBe(first);
    expect(mocks.fetchImmediateOpenSources).toHaveBeenCalledTimes(1);
    expect(mocks.pingSluProduct).toHaveBeenCalledTimes(2);

    vi.setSystemTime(new Date('2026-03-21T12:06:00.000Z'));
    const refreshed = await getPublicDatasourceSummary(true);
    const refreshedCardsById = new Map(refreshed.cards.map((card) => [card.id, card]));

    expect(mocks.fetchImmediateOpenSources).toHaveBeenCalledTimes(2);
    expect(refreshed.checkedAt).toBe('2026-03-21T12:06:00.000Z');
    expect(refreshedCardsById.get('sgu')).toMatchObject({
      status: 'CONNECTED',
      reason: 'Livecheck OK (200)',
      endpoint: 'https://sgu.test',
    });
  });

  it('returns local hydro, protected-area and SGU layers with filtered valid features', async () => {
    process.env.SGU_DB_COVERAGE_MODE = 'sample';
    mocks.queryRaw
      .mockResolvedValueOnce([{ regclass: 'hydro.stream' }])
      .mockResolvedValueOnce([
        {
          objid: 'stream-1',
          namn: 'Test Creek',
          kategori: 'stream',
          geojson: '{"type":"LineString","coordinates":[[18.0,59.0],[18.1,59.1]]}',
        },
        {
          objid: 'stream-2',
          namn: 'Broken Creek',
          kategori: 'stream',
          geojson: 'not-json',
        },
      ])
      .mockResolvedValueOnce([
        {
          nvr_id: 'nvr-1',
          name: 'Protected Area',
          protection_type: 'Nature Reserve',
          source: 'NVR',
          geojson: '{"type":"Polygon","coordinates":[[[18.0,59.0],[18.1,59.0],[18.1,59.1],[18.0,59.0]]]}',
        },
      ])
      .mockResolvedValueOnce([
        {
          source_key: 'sgu-ground',
          layer_code: 1,
          layer_label: 'Clay',
          map_type: 2,
          source_scale: '1:25000',
          geojson: '{"type":"Polygon","coordinates":[[[18.0,59.0],[18.1,59.0],[18.1,59.1],[18.0,59.0]]]}',
        },
      ])
      .mockResolvedValueOnce([
        {
          source_key: 'sgu-slide',
          feature_code: 9,
          feature_label: 'Risk',
          symbol: 4,
          geojson: '{"type":"Polygon","coordinates":[[[18.0,59.0],[18.1,59.0],[18.1,59.1],[18.0,59.0]]]}',
        },
      ]);

    const { getHydroLayer, getProtectedAreaLayer, getSguGroundLayerLayer, getSguLandslideLayer } =
      await import('../../server/services/publicUiService');

    const missingHydro = await getHydroLayer('lakes', null);
    expect(missingHydro).toEqual({
      type: 'FeatureCollection',
      features: [],
      meta: {
        source: 'unavailable',
        available: false,
        manualReviewRequired: true,
        warning: 'bbox kravs for hydrolager.',
      },
    });

    const streamLayer = await getHydroLayer('streams', {
      minLng: 17.9,
      minLat: 58.9,
      maxLng: 18.2,
      maxLat: 59.2,
    });
    expect(streamLayer.features).toHaveLength(1);
    expect(streamLayer.features[0]).toMatchObject({
      geometry: { type: 'LineString' },
      properties: {
        objid: 'stream-1',
        namn: 'Test Creek',
        kategori: 'stream',
        source: 'local_postgis',
      },
    });
    expect(streamLayer.meta).toEqual({
      source: 'local_postgis',
      available: true,
      manualReviewRequired: false,
    });

    const protectedLayer = await getProtectedAreaLayer(null, 2);
    expect(protectedLayer.features).toHaveLength(1);
    expect(protectedLayer.meta).toEqual({
      source: 'local_postgis',
      available: true,
      manualReviewRequired: false,
      coverageMode: 'complete',
    });

    const groundLayer = await getSguGroundLayerLayer({
      minLng: 17.9,
      minLat: 58.9,
      maxLng: 18.2,
      maxLat: 59.2,
    });
    expect(groundLayer.features[0]).toMatchObject({
      properties: {
        source_key: 'sgu-ground',
        layer_code: 1,
        layer_label: 'Clay',
        map_type: 2,
        source_scale: '1:25000',
      },
    });
    expect(groundLayer.meta).toEqual({
      coverageMode: 'sample',
      screeningOnly: true,
      manualReviewRequired: true,
      featureLimit: 1000,
    });

    const landslideLayer = await getSguLandslideLayer({
      minLng: 17.9,
      minLat: 58.9,
      maxLng: 18.2,
      maxLat: 59.2,
    });
    expect(landslideLayer.features[0]).toMatchObject({
      properties: {
        source_key: 'sgu-slide',
        feature_code: 9,
        feature_label: 'Risk',
        symbol: 4,
      },
    });
    expect(landslideLayer.meta).toEqual({
      coverageMode: 'sample',
      screeningOnly: true,
      manualReviewRequired: true,
      reviewBufferMeters: 150,
      featureLimit: 1500,
    });
  });

  it('uses local PostGIS audits when local tables are available', async () => {
    mocks.queryRaw
      .mockResolvedValueOnce([{ regclass: 'hydro.water_body' }])
      .mockResolvedValueOnce([{ has_rows: true }])
      .mockResolvedValueOnce([
        {
          external_id: 'water-1',
          name: 'Malaren',
          water_type: 'lake',
          status_ecological: 'Good',
          status_chemical: 'Moderate',
          distance_meters: 12.4,
        },
      ])
      .mockResolvedValueOnce([{ regclass: 'culture.heritage_object' }])
      .mockResolvedValueOnce([
        {
          external_id: 'heritage-1',
          object_type: 'Runestone',
          name: 'Rune A',
          protection_class: 'A',
          distance_meters: 33.6,
        },
      ])
      .mockResolvedValueOnce([{ regclass: 'climate.flood_risk_area' }])
      .mockResolvedValueOnce([
        { external_id: 'flood-1', source: 'msb', return_period: '100 years' },
        { external_id: 'flood-2', source: 'msb', return_period: '200 years' },
      ]);

    const { runWaterAudit, runHeritageAudit, runClimateAudit } =
      await import('../../server/services/publicUiService');

    const water = await runWaterAudit(59.3293, 18.0686);
    expect(water).toEqual({
      hits: [
        {
          external_id: 'water-1',
          name: 'Malaren',
          water_type: 'lake',
          status_ecological: 'Good',
          status_chemical: 'Moderate',
          distance: 12,
        },
      ],
      hasWaterRisk: true,
      buffer_meters: 500,
      source: 'local_postgis',
      sourceAvailable: true,
      manualReviewRequired: false,
    });

    const heritage = await runHeritageAudit(59.3293, 18.0686);
    expect(heritage).toEqual({
      hits: [
        {
          id: 'heritage-1',
          object_type: 'Runestone',
          name: 'Rune A',
          protection_class: 'A',
          distance: 34,
        },
      ],
      hasHeritageRisk: true,
      buffer_meters: 100,
      source: 'local_postgis',
      sourceAvailable: true,
      manualReviewRequired: false,
    });

    const climate = await runClimateAudit(59.3293, 18.0686);
    expect(climate).toEqual({
      isFlooded: true,
      sourceAvailable: true,
      manualReviewRequired: false,
      source: 'local_postgis',
      hitCount: 2,
      warning: 'Lokal oversvamningsdatabas markerar traff. Returperiod: 100 years, 200 years.',
    });
  });

  it('falls back to live water, heritage and climate checks when local tables are unavailable', async () => {
    process.env.VISS_API_KEY = 'viss-key';
    process.env.VISS_API_BASE_URL = 'https://viss.test/api';

    mocks.queryRaw
      .mockResolvedValueOnce([{ regclass: null }])
      .mockResolvedValueOnce([{ regclass: null }])
      .mockResolvedValueOnce([{ regclass: null }])
      .mockResolvedValueOnce([{ regclass: null }]);

    const fetchMock = vi.mocked(global.fetch);
    fetchMock.mockImplementation(async (input: string | URL | Request) => {
      const url = String(input);

      if (url.startsWith('https://viss.test/api?') && url.includes('method=coordinateinfo')) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              NearbyWaters: [
                {
                  EU_CD: 'EU-1',
                  Name: 'Lake One',
                  WaterCategory: 'LAKE',
                  XCoordinate: '59,3293',
                  YCoordinate: '18,0686',
                },
                {
                  MS_CD: 'MS-2',
                  SwedishName: 'Lake Two',
                  WaterCategory: 'STREAM',
                  XCoordinate: '59,3300',
                  YCoordinate: '18,0700',
                },
              ],
            }),
        } as Response;
      }

      if (url.startsWith('https://viss.test/api?') && url.includes('waterpublicid=EU-1')) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify([
              {
                EU_CD: 'EU-1',
                RiskSections: [
                  { SectionName: 'Ekologisk status', Risk: 'High risk' },
                  { SectionName: 'Kemisk status', Risk: 'Moderate risk' },
                ],
              },
            ]),
        } as Response;
      }

      if (url.startsWith('https://viss.test/api?') && url.includes('waterpublicid=MS-2')) {
        return {
          ok: false,
          status: 502,
          text: async () => 'bad gateway',
        } as Response;
      }

      if (url.startsWith('https://pub.raa.se/visning/lamningar_v1/wfs?') && url.includes('fornlamning')) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              features: [
                {
                  id: 'raa-1',
                  geometry: { type: 'Point', coordinates: [18.0687, 59.3294] },
                  properties: {
                    lamningstyp: 'Fornlamning',
                    namn: 'Heritage One',
                    antikvarisk_bedomning: 'Protected',
                  },
                },
              ],
            }),
        } as Response;
      }

      if (url.startsWith('https://pub.raa.se/visning/lamningar_v1/wfs?')) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ features: [] }),
        } as Response;
      }

      if (url.startsWith('https://inspire.msb.se/geoserver/oversvamning/wfs?')) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ features: [{ id: 'flood-live-1' }] }),
        } as Response;
      }

      throw new Error(`Unhandled fetch URL: ${url}`);
    });

    const { runWaterAudit, runHeritageAudit, runClimateAudit, getHydroLayer } =
      await import('../../server/services/publicUiService');

    const water = await runWaterAudit(59.3293, 18.0686);
    expect(water.source).toBe('viss_open_api');
    expect(water.sourceAvailable).toBe(true);
    expect(water.manualReviewRequired).toBe(true);
    expect(water.hasWaterRisk).toBe(true);
    expect(water.hits).toHaveLength(2);
    expect(water.hits[0]).toMatchObject({
      external_id: 'EU-1',
      name: 'Lake One',
      water_type: 'LAKE',
      status_ecological: 'High risk',
      status_chemical: 'Moderate risk',
      distance: 0,
    });
    expect(water.warning).toContain('VISS Open API livefallback');
    expect(water.warning).toContain('Riskklassning saknas delvis');

    const heritage = await runHeritageAudit(59.3293, 18.0686);
    expect(heritage.source).toBe('raa_live');
    expect(heritage.sourceAvailable).toBe(true);
    expect(heritage.manualReviewRequired).toBe(true);
    expect(heritage.hasHeritageRisk).toBe(true);
    expect(heritage.hits[0]).toMatchObject({
      id: 'raa-1',
      object_type: 'Fornlamning',
      name: 'Heritage One',
      protection_class: 'Protected',
    });
    expect(heritage.warning).toContain('RAA livefallback');

    const climate = await runClimateAudit(59.3293, 18.0686);
    expect(climate).toEqual({
      isFlooded: true,
      sourceAvailable: true,
      manualReviewRequired: true,
      source: 'msb_live',
      hitCount: 1,
      warning: 'MSB livekontroll ar indikativ och maste granskas manuellt innan slutsats.',
    });

    const hydro = await getHydroLayer('lakes', {
      minLng: 17.9,
      minLat: 58.9,
      maxLng: 18.2,
      maxLat: 59.2,
    });
    expect(hydro).toEqual({
      type: 'FeatureCollection',
      features: [],
      meta: {
        source: 'unavailable',
        available: false,
        manualReviewRequired: true,
        warning:
          'Lokal hydrotabell for sjoar saknas. Officiell VISS API kravs for extern vattenfallback och anvands inte anonymt.',
      },
    });
  });

  it('returns unavailable warnings when live fallback probes fail', async () => {
    process.env.VISS_API_KEY = 'viss-key';
    process.env.VISS_API_BASE_URL = 'https://viss.test/api';

    mocks.queryRaw.mockResolvedValueOnce([{ regclass: null }]).mockResolvedValueOnce([{ regclass: null }]);

    const fetchMock = vi.mocked(global.fetch);
    fetchMock.mockImplementation(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.startsWith('https://viss.test/api?')) {
        return {
          ok: false,
          status: 500,
          text: async () => 'server error',
        } as Response;
      }
      throw new Error(`network down for ${url}`);
    });

    const { runWaterAudit, runClimateAudit } = await import('../../server/services/publicUiService');

    const water = await runWaterAudit(59.3293, 18.0686);
    expect(water).toEqual({
      hits: [],
      hasWaterRisk: false,
      buffer_meters: 500,
      source: 'unavailable',
      sourceAvailable: false,
      manualReviewRequired: true,
      warning: 'VISS Open API misslyckades: HTTP 500: server error',
    });

    const climate = await runClimateAudit(59.3293, 18.0686);
    expect(climate).toMatchObject({
      isFlooded: null,
      sourceAvailable: false,
      manualReviewRequired: true,
      source: 'unavailable',
      hitCount: 0,
    });
    expect(climate.warning).toContain(
      'MSB livekontroll misslyckades: network down for https://inspire.msb.se/geoserver/oversvamning/wfs?',
    );
  });
});
