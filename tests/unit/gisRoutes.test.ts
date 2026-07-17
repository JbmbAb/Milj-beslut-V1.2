import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTokenPair } from '../../server/security/auth';
import { SOURCE_CATALOG } from '../../server/datasources/catalog';

const mocks = vi.hoisted(() => ({
  parseBbox: vi.fn(),
  getProtectedAreaLayer: vi.fn(),
  getNatura2000Layer: vi.fn(),
  getInternationalProtectionLayer: vi.fn(),
  getWaterProtectionLayer: vi.fn(),
  getSguGroundLayerLayer: vi.fn(),
  getSguWellLayer: vi.fn(),
  getSguPermeabilityLayer: vi.fn(),
  getSguGroundwaterMagazineLayer: vi.fn(),
  getSguGroundwaterBodyLayer: vi.fn(),
  getSguLandslideLayer: vi.fn(),
  getSguCoastalErosionLayer: vi.fn(),
  getSguHighestCoastlineLayer: vi.fn(),
  getFloodRiskLayer: vi.fn(),
  runWaterAudit: vi.fn(),
  runHeritageAudit: vi.fn(),
  runClimateAudit: vi.fn(),
  getPublicDatasourceSummary: vi.fn(),
  getHydroLayer: vi.fn(),
  getWaterCatchmentLayer: vi.fn(),
  getMainCatchmentLayer: vi.fn(),
  getDatasetMapLayer: vi.fn(),
  getMarkCoverLayer: vi.fn(),
  getPropertyLayer: vi.fn(),
  getLantmaterietOpenMapStatus: vi.fn(),
  fetchImmediateOpenSources: vi.fn(),
  callSluProductApi: vi.fn(),
  getSluProductStatus: vi.fn(),
  pingSluProduct: vi.fn(),
  searchSluObservations: vi.fn(),
  getSmhiWeatherRisk: vi.fn(),
  runSpatialAudit: vi.fn(),
  getTopo10Layer: vi.fn(),
}));

vi.mock('../../server/repositories/tokenRepository', () => ({
  isTokenRevoked: vi.fn(async () => false),
  markRefreshTokenAsUsed: vi.fn(async () => undefined),
  revokeRefreshToken: vi.fn(async () => undefined),
  cleanupExpiredTokenRevocations: vi.fn(async () => 0),
}));

vi.mock('../../server/services/publicUiService', () => ({
  parseBbox: mocks.parseBbox,
  getProtectedAreaLayer: mocks.getProtectedAreaLayer,
  getNatura2000Layer: mocks.getNatura2000Layer,
  getInternationalProtectionLayer: mocks.getInternationalProtectionLayer,
  getWaterProtectionLayer: mocks.getWaterProtectionLayer,
  getSguGroundLayerLayer: mocks.getSguGroundLayerLayer,
  getSguWellLayer: mocks.getSguWellLayer,
  getSguPermeabilityLayer: mocks.getSguPermeabilityLayer,
  getSguGroundwaterMagazineLayer: mocks.getSguGroundwaterMagazineLayer,
  getSguGroundwaterBodyLayer: mocks.getSguGroundwaterBodyLayer,
  getSguLandslideLayer: mocks.getSguLandslideLayer,
  getSguCoastalErosionLayer: mocks.getSguCoastalErosionLayer,
  getSguHighestCoastlineLayer: mocks.getSguHighestCoastlineLayer,
  getFloodRiskLayer: mocks.getFloodRiskLayer,
  runWaterAudit: mocks.runWaterAudit,
  runHeritageAudit: mocks.runHeritageAudit,
  runClimateAudit: mocks.runClimateAudit,
  getPublicDatasourceSummary: mocks.getPublicDatasourceSummary,
  getHydroLayer: mocks.getHydroLayer,
  getWaterCatchmentLayer: mocks.getWaterCatchmentLayer,
  getMainCatchmentLayer: mocks.getMainCatchmentLayer,
  getDatasetMapLayer: mocks.getDatasetMapLayer,
  getTopo10Layer: mocks.getTopo10Layer,
}));

vi.mock('../../server/services/lantmaterietService', () => ({
  getLantmaterietOpenMapStatus: mocks.getLantmaterietOpenMapStatus,
}));

vi.mock('../../server/services/openDataSourceService', () => ({
  fetchImmediateOpenSources: mocks.fetchImmediateOpenSources,
}));

vi.mock('../../server/services/propertyUnitService', () => ({
  getPropertyLayer: mocks.getPropertyLayer,
}));

vi.mock('../../server/services/markCoverService', () => ({
  getMarkCoverLayer: mocks.getMarkCoverLayer,
}));

vi.mock('../../server/services/sluService', () => ({
  callSluProductApi: mocks.callSluProductApi,
  getSluProductStatus: mocks.getSluProductStatus,
  pingSluProduct: mocks.pingSluProduct,
  searchSluObservations: mocks.searchSluObservations,
}));

vi.mock('../../server/services/smhiWeatherService', () => ({
  getSmhiWeatherRisk: mocks.getSmhiWeatherRisk,
}));

vi.mock('../../server/services/spatialAuditService', () => ({
  runSpatialAudit: mocks.runSpatialAudit,
}));

vi.mock('../../server/services/postgisLayerService', () => ({
  getDatasetMapLayer: mocks.getDatasetMapLayer,
}));

import gisRoutes from '../../server/routes/gis.routes';
import geodataRoutes from '../../server/routes/geodata.routes';

const app = express();
app.use(express.json());
app.use(gisRoutes);
app.use(geodataRoutes);

function authHeader(role: 'ADMIN' | 'CONSULTANT' = 'ADMIN') {
  return `Bearer ${
    createTokenPair({
      id: `${role.toLowerCase()}-1`,
      organisationId: 'org-1',
      bankidId: `${role.toLowerCase()}:one`,
      role,
    }).accessToken
  }`;
}

const validBbox = {
  minLng: 18,
  minLat: 59,
  maxLng: 19,
  maxLat: 60,
};

describe('gis.routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.parseBbox.mockImplementation((value: string | null) =>
      value === '18,59,19,60' ? validBbox : null,
    );
    mocks.getProtectedAreaLayer.mockResolvedValue({ type: 'FeatureCollection', features: [], meta: {} });
    mocks.getNatura2000Layer.mockResolvedValue({ type: 'FeatureCollection', features: [], meta: {} });
    mocks.getInternationalProtectionLayer.mockResolvedValue({
      type: 'FeatureCollection',
      features: [],
      meta: {},
    });
    mocks.getWaterProtectionLayer.mockResolvedValue({ type: 'FeatureCollection', features: [], meta: {} });
    mocks.getSguGroundLayerLayer.mockResolvedValue({ type: 'FeatureCollection', features: [], meta: {} });
    mocks.getSguWellLayer.mockResolvedValue({ type: 'FeatureCollection', features: [], meta: {} });
    mocks.getSguPermeabilityLayer.mockResolvedValue({ type: 'FeatureCollection', features: [], meta: {} });
    mocks.getSguGroundwaterMagazineLayer.mockResolvedValue({
      type: 'FeatureCollection',
      features: [],
      meta: {},
    });
    mocks.getSguGroundwaterBodyLayer.mockResolvedValue({ type: 'FeatureCollection', features: [], meta: {} });
    mocks.getSguLandslideLayer.mockResolvedValue({ type: 'FeatureCollection', features: [], meta: {} });
    mocks.getSguCoastalErosionLayer.mockResolvedValue({ type: 'FeatureCollection', features: [], meta: {} });
    mocks.getSguHighestCoastlineLayer.mockResolvedValue({
      type: 'FeatureCollection',
      features: [],
      meta: {},
    });
    mocks.getFloodRiskLayer.mockResolvedValue({ type: 'FeatureCollection', features: [], meta: {} });
    mocks.getPropertyLayer.mockResolvedValue({ type: 'FeatureCollection', features: [], meta: {} });
    mocks.getHydroLayer.mockResolvedValue({ type: 'FeatureCollection', features: [], meta: {} });
    mocks.getWaterCatchmentLayer.mockResolvedValue({ type: 'FeatureCollection', features: [], meta: {} });
    mocks.getMainCatchmentLayer.mockResolvedValue({ type: 'FeatureCollection', features: [], meta: {} });
    mocks.getDatasetMapLayer.mockResolvedValue({ type: 'FeatureCollection', features: [], meta: {} });
    mocks.getMarkCoverLayer.mockResolvedValue({ type: 'FeatureCollection', features: [], source: 'postgis' });
    mocks.runSpatialAudit.mockResolvedValue({
      protectedAreaHits: [{ id: 'nvr-1' }],
      protectedAreaAvailable: true,
      protectedAreaWarning: '',
      isProtected: true,
      sgu: { manualReviewRequired: false, riskLevel: 'MEDIUM' },
      text: 'Spatialt beslutsstod',
      sources: [{ web: { title: 'SGU', uri: 'https://sgu.example.test' } }],
    });
    mocks.runWaterAudit.mockResolvedValue({ ok: true, water: 'audit' });
    mocks.runHeritageAudit.mockResolvedValue({ ok: true, heritage: 'audit' });
    mocks.runClimateAudit.mockResolvedValue({ ok: true, climate: 'audit' });
    mocks.getPublicDatasourceSummary.mockResolvedValue({
      checkedAt: '2026-03-22T00:00:00.000Z',
      cards: [
        {
          id: 'sgu',
          name: 'SGU',
          provider: 'SGU',
          status: 'CONNECTED',
          activation: 'IMMEDIATE',
          reason: 'Livecheck OK',
        },
        {
          id: 'smhi',
          name: 'SMHI',
          provider: 'SMHI',
          status: 'ERROR',
          activation: 'IMMEDIATE',
          reason: 'Upstream timeout',
        },
        {
          id: 'slu',
          name: 'SLU',
          provider: 'SLU',
          status: 'DISCONNECTED',
          activation: 'PERMIT_REQUIRED',
          reason: 'API key missing',
        },
      ],
    });
    mocks.getLantmaterietOpenMapStatus.mockResolvedValue({
      ok: true,
      status: 200,
      endpoint: 'https://lantmateriet.example.test',
    });
    mocks.fetchImmediateOpenSources.mockResolvedValue([
      { source: 'sgu', ok: true },
      { source: 'smhi', ok: true },
    ]);
    mocks.getSluProductStatus.mockReturnValue([{ product: 'taxonomy', configured: true }]);
    mocks.pingSluProduct.mockResolvedValue({ ok: true, status: 200, endpoint: 'https://slu.example.test' });
    mocks.searchSluObservations.mockResolvedValue({ total: 1, rows: [{ id: 'obs-1' }] });
    mocks.callSluProductApi.mockResolvedValue({ ok: true, rows: [] });
    mocks.getSmhiWeatherRisk.mockResolvedValue({ source: 'smhi_pmp3g', score: 'LOW' });
  });

  it('serves /api/geodata aliases with the same handlers as /api/layers', async () => {
    const soilBad = await request(app).get('/api/geodata/soil');
    expect(soilBad.status).toBe(400);

    const soil = await request(app).get('/api/geodata/soil?bbox=18,59,19,60');
    expect(soil.status).toBe(200);
    expect(mocks.getSguGroundLayerLayer).toHaveBeenCalledWith(validBbox);

    const wells = await request(app).get('/api/geodata/wells?bbox=18,59,19,60&limit=50');
    expect(wells.status).toBe(200);
    expect(mocks.getSguWellLayer).toHaveBeenCalledWith(validBbox, 50);

    const lakes = await request(app).get('/api/geodata/lakes?bbox=18,59,19,60');
    expect(lakes.status).toBe(200);
    expect(mocks.getHydroLayer).toHaveBeenCalledWith('lakes', validBbox);

    const topoWater = await request(app).get('/api/geodata/topo-water?bbox=18,59,19,60');
    expect(topoWater.status).toBe(200);
    expect(mocks.getTopo10Layer).toHaveBeenCalledWith(validBbox, 'vatten');
  });

  it('serves protected area and hydro layers with bbox parsing and validation', async () => {
    const invalid = await request(app).get('/api/layers/nvr?bbox=bad');
    expect(invalid.status).toBe(400);

    const nvr = await request(app).get('/api/layers/nvr?bbox=18,59,19,60&limit=12');
    expect(nvr.status).toBe(200);
    expect(mocks.getProtectedAreaLayer).toHaveBeenCalledWith(validBbox, 12);

    const natura2000 = await request(app).get('/api/layers/natura2000?bbox=18,59,19,60&limit=25');
    expect(natura2000.status).toBe(200);
    expect(mocks.getNatura2000Layer).toHaveBeenCalledWith(validBbox, 25);

    const internationalProtection = await request(app).get(
      '/api/layers/international-protection?bbox=18,59,19,60',
    );
    expect(internationalProtection.status).toBe(200);
    expect(mocks.getInternationalProtectionLayer).toHaveBeenCalledWith(validBbox, 1000);

    const waterProtection = await request(app).get('/api/layers/water-protection?bbox=18,59,19,60&limit=5');
    expect(waterProtection.status).toBe(200);
    expect(mocks.getWaterProtectionLayer).toHaveBeenCalledWith(validBbox, 5);

    const lakesInvalid = await request(app).get('/api/layers/hydro.lakes?bbox=bad');
    expect(lakesInvalid.status).toBe(400);

    const streams = await request(app).get('/api/layers/hydro.streams?bbox=18,59,19,60');
    expect(streams.status).toBe(200);
    expect(mocks.getHydroLayer).toHaveBeenCalledWith('streams', validBbox);

    const floodInvalid = await request(app).get('/api/layers/climate.flood-risk?bbox=bad');
    expect(floodInvalid.status).toBe(400);

    const flood = await request(app).get('/api/layers/climate.flood-risk?bbox=18,59,19,60');
    expect(flood.status).toBe(200);
    expect(mocks.getFloodRiskLayer).toHaveBeenCalledWith(validBbox);

    const markcover = await request(app).get('/api/layers/markcover?bbox=18,59,19,60');
    expect(markcover.status).toBe(200);
    expect(mocks.getMarkCoverLayer).toHaveBeenCalledWith([18, 59, 19, 60]);
  });

  it('serves SGU and property layers and requires bbox where expected', async () => {
    const groundMissing = await request(app).get('/api/layers/sgu/grundlager');
    expect(groundMissing.status).toBe(400);

    const ground = await request(app).get('/api/layers/sgu/grundlager?bbox=18,59,19,60');
    expect(ground.status).toBe(200);
    expect(mocks.getSguGroundLayerLayer).toHaveBeenCalledWith(validBbox);

    const wells = await request(app).get('/api/layers/sgu/brunnar?bbox=18,59,19,60&limit=50');
    expect(wells.status).toBe(200);
    expect(mocks.getSguWellLayer).toHaveBeenCalledWith(validBbox, 50);

    const permeability = await request(app).get('/api/layers/sgu/genomslapplighet?bbox=18,59,19,60');
    expect(permeability.status).toBe(200);
    expect(mocks.getSguPermeabilityLayer).toHaveBeenCalledWith(validBbox);

    const groundwaterMagazine = await request(app).get('/api/layers/sgu/grundvattenmagasin?bbox=18,59,19,60');
    expect(groundwaterMagazine.status).toBe(200);
    expect(mocks.getSguGroundwaterMagazineLayer).toHaveBeenCalledWith(validBbox);

    const groundwaterBody = await request(app).get('/api/layers/sgu/grundvattenforekomster?bbox=18,59,19,60');
    expect(groundwaterBody.status).toBe(200);
    expect(mocks.getSguGroundwaterBodyLayer).toHaveBeenCalledWith(validBbox);

    const landslide = await request(app).get('/api/layers/sgu/jordskred-raviner?bbox=18,59,19,60');
    expect(landslide.status).toBe(200);
    expect(mocks.getSguLandslideLayer).toHaveBeenCalledWith(validBbox);

    const coastalErosion = await request(app).get('/api/layers/sgu/kusterosion?bbox=18,59,19,60&limit=25');
    expect(coastalErosion.status).toBe(200);
    expect(mocks.getSguCoastalErosionLayer).toHaveBeenCalledWith(validBbox, 25);

    const highestCoastline = await request(app).get('/api/layers/sgu/hogsta-kustlinjen?bbox=18,59,19,60');
    expect(highestCoastline.status).toBe(200);
    expect(mocks.getSguHighestCoastlineLayer).toHaveBeenCalledWith(validBbox, 1000);

    const catchment = await request(app).get('/api/layers/hydro.water-catchments?bbox=18,59,19,60');
    expect(catchment.status).toBe(200);
    expect(mocks.getWaterCatchmentLayer).toHaveBeenCalledWith(validBbox);

    const mainCatchment = await request(app).get('/api/layers/hydro.main-catchments?bbox=18,59,19,60');
    expect(mainCatchment.status).toBe(200);
    expect(mocks.getDatasetMapLayer).toHaveBeenCalledWith('smhi_huvudavrinningsomraden', validBbox, 1500);

    const mainCatchmentMissing = await request(app).get('/api/layers/hydro.main-catchments');
    expect(mainCatchmentMissing.status).toBe(400);

    const datasetLayer = await request(app).get('/api/layers/dataset/sgu_fastmark?bbox=18,59,19,60');
    expect(datasetLayer.status).toBe(200);
    expect(mocks.getDatasetMapLayer).toHaveBeenCalledWith('sgu_fastmark', validBbox, 1500);

    const propertyMissing = await request(app).get('/api/layers/property');
    expect(propertyMissing.status).toBe(400);

    const property = await request(app).get('/api/layers/property?bbox=18,59,19,60');
    expect(property.status).toBe(200);
    expect(mocks.getPropertyLayer).toHaveBeenCalledWith(validBbox, undefined);
  });

  it('runs spatial, water, heritage and climate audits with coordinate validation', async () => {
    const missingSpatial = await request(app).post('/api/spatial-audit').send({});
    expect(missingSpatial.status).toBe(400);

    const spatial = await request(app).post('/api/spatial-audit').send({ lat: 59.3, lng: 18.0 });
    expect(spatial.status).toBe(200);
    expect(spatial.body).toMatchObject({
      hits: [{ id: 'nvr-1' }],
      protectedAreaAvailable: true,
      isProtected: true,
      manualReviewRequired: false,
      text: 'Spatialt beslutsstod',
    });

    const water = await request(app).post('/api/hydro/water-audit').send({ lat: 59.3, lng: 18.0 });
    expect(water.status).toBe(200);
    expect(mocks.runWaterAudit).toHaveBeenCalledWith(59.3, 18.0);

    const heritage = await request(app).post('/api/culture/heritage-audit').send({ lat: 59.3, lng: 18.0 });
    expect(heritage.status).toBe(200);
    expect(mocks.runHeritageAudit).toHaveBeenCalledWith(59.3, 18.0);

    const climate = await request(app).post('/api/climate/smhi-audit').send({ lat: 59.3, lng: 18.0 });
    expect(climate.status).toBe(200);
    expect(mocks.runClimateAudit).toHaveBeenCalledWith(59.3, 18.0);
  });

  it('returns datasource public summary and aggregated health', async () => {
    const summary = await request(app).get('/api/datasources/public-summary?refresh=true');
    expect(summary.status).toBe(200);
    expect(mocks.getPublicDatasourceSummary).toHaveBeenCalledWith(true);

    const health = await request(app).get('/api/datasources/health');
    expect(health.status).toBe(200);
    expect(health.body).toMatchObject({
      ok: true,
      total: 3,
      connected: 1,
      disconnected: 1,
      errors: 1,
      permitRequired: 1,
      allOpenSourcesActive: false,
      checkedAt: '2026-03-22T00:00:00.000Z',
    });
    expect(health.body.notResponding).toEqual([
      {
        name: 'SMHI',
        provider: 'SMHI',
        status: 'ERROR',
        reason: 'Upstream timeout',
      },
    ]);
  });

  it('validates and returns SMHI weather risk', async () => {
    const missing = await request(app).get('/api/weather/smhi-risk');
    expect(missing.status).toBe(400);

    const invalid = await request(app).get('/api/weather/smhi-risk?lat=999&lng=18');
    expect(invalid.status).toBe(400);

    const success = await request(app).get(
      '/api/weather/smhi-risk?lat=59.3293&lng=18.0686&municipality=Haninge',
    );
    expect(success.status).toBe(200);
    expect(mocks.getSmhiWeatherRisk).toHaveBeenCalledWith({
      lat: 59.3293,
      lng: 18.0686,
      municipality: 'Haninge',
    });
  });

  it('protects and serves datasource catalog plus Lantmateriet status', async () => {
    const unauthorized = await request(app).get('/api/datasources/catalog');
    expect(unauthorized.status).toBe(401);

    const catalog = await request(app).get('/api/datasources/catalog').set('Authorization', authHeader());
    expect(catalog.status).toBe(200);
    expect(catalog.body.sources).toHaveLength(SOURCE_CATALOG.length);

    const lantmateriet = await request(app)
      .get('/api/datasources/lantmateriet/open/status')
      .set('Authorization', authHeader());
    expect(lantmateriet.status).toBe(200);
    expect(lantmateriet.body.result.endpoint).toContain('lantmateriet.example.test');
  });

  it('serves SLU datasource status and ping validation', async () => {
    const status = await request(app).get('/api/datasources/slu/status').set('Authorization', authHeader());
    expect(status.status).toBe(200);
    expect(status.body.products).toEqual([{ product: 'taxonomy', configured: true }]);

    const invalid = await request(app)
      .get('/api/datasources/slu/ping/not-supported')
      .set('Authorization', authHeader());
    expect(invalid.status).toBe(400);

    const ping = await request(app)
      .get('/api/datasources/slu/ping/species_observations')
      .set('Authorization', authHeader());
    expect(ping.status).toBe(200);
    expect(mocks.pingSluProduct).toHaveBeenCalledWith('species_observations');
  });

  it('validates and proxies SLU observation and proxy requests', async () => {
    const observationsBad = await request(app)
      .post('/api/datasources/slu/observations')
      .set('Authorization', authHeader())
      .send({ purpose: 'lookup' });
    expect(observationsBad.status).toBe(400);

    const observations = await request(app)
      .post('/api/datasources/slu/observations')
      .set('Authorization', authHeader())
      .send({ projectId: 'project-1', purpose: 'lookup', payload: { q: 'sparv' } });
    expect(observations.status).toBe(200);
    expect(mocks.searchSluObservations).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'project-1',
        purpose: 'lookup',
        payload: { q: 'sparv' },
        user: expect.objectContaining({ id: 'admin-1' }),
      }),
    );

    const proxyBad = await request(app)
      .post('/api/datasources/slu/proxy')
      .set('Authorization', authHeader())
      .send({ product: 'species_observations', method: 'PUT', purpose: 'lookup' });
    expect(proxyBad.status).toBe(400);

    const proxy = await request(app)
      .post('/api/datasources/slu/proxy')
      .set('Authorization', authHeader())
      .send({
        product: 'species_observations',
        method: 'POST',
        pathSuffix: '/recent',
        payload: { q: 'sparv' },
        projectId: 'project-1',
        purpose: 'lookup',
      });
    expect(proxy.status).toBe(200);
    expect(mocks.callSluProductApi).toHaveBeenCalledWith(
      expect.objectContaining({
        product: 'species_observations',
        method: 'POST',
        pathSuffix: '/recent',
        projectId: 'project-1',
        purpose: 'lookup',
        user: expect.objectContaining({ id: 'admin-1' }),
      }),
    );
  });

  it('exposes federated OGC catalog summaries without auth', async () => {
    const response = await request(app).get('/api/reference/ogc-catalogs');
    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(Array.isArray(response.body.catalogs)).toBe(true);
    expect(response.body.catalogs.some((c: { id: string }) => c.id === 'lst_geoserver_wms')).toBe(true);
  });

  it('syncs open datasources for authenticated users', async () => {
    const unauthorized = await request(app).post('/api/datasources/open/sync').send({});
    expect(unauthorized.status).toBe(401);

    const sync = await request(app)
      .post('/api/datasources/open/sync')
      .set('Authorization', authHeader('CONSULTANT'))
      .send({});
    expect(sync.status).toBe(200);
    expect(sync.body).toEqual({
      ok: true,
      results: [
        { source: 'sgu', ok: true },
        { source: 'smhi', ok: true },
      ],
    });
  });
});
