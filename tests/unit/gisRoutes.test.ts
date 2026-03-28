import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTokenPair } from '../../server/security/auth';
import { SOURCE_CATALOG } from '../../server/datasources/catalog';

const mocks = vi.hoisted(() => ({
  parseBbox: vi.fn(),
  getProtectedAreaLayer: vi.fn(),
  getSguGroundLayerLayer: vi.fn(),
  getSguLandslideLayer: vi.fn(),
  runWaterAudit: vi.fn(),
  runHeritageAudit: vi.fn(),
  runClimateAudit: vi.fn(),
  getPublicDatasourceSummary: vi.fn(),
  getHydroLayer: vi.fn(),
  getPropertyLayer: vi.fn(),
  getLantmaterietOpenMapStatus: vi.fn(),
  fetchImmediateOpenSources: vi.fn(),
  callSluProductApi: vi.fn(),
  getSluProductStatus: vi.fn(),
  pingSluProduct: vi.fn(),
  searchSluObservations: vi.fn(),
  getSmhiWeatherRisk: vi.fn(),
  runSpatialAudit: vi.fn(),
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
  getSguGroundLayerLayer: mocks.getSguGroundLayerLayer,
  getSguLandslideLayer: mocks.getSguLandslideLayer,
  runWaterAudit: mocks.runWaterAudit,
  runHeritageAudit: mocks.runHeritageAudit,
  runClimateAudit: mocks.runClimateAudit,
  getPublicDatasourceSummary: mocks.getPublicDatasourceSummary,
  getHydroLayer: mocks.getHydroLayer,
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

import gisRoutes from '../../server/routes/gis.routes';

const app = express();
app.use(express.json());
app.use(gisRoutes);

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
    mocks.getSguGroundLayerLayer.mockResolvedValue({ type: 'FeatureCollection', features: [], meta: {} });
    mocks.getSguLandslideLayer.mockResolvedValue({ type: 'FeatureCollection', features: [], meta: {} });
    mocks.getPropertyLayer.mockResolvedValue({ type: 'FeatureCollection', features: [], meta: {} });
    mocks.getHydroLayer.mockResolvedValue({ type: 'FeatureCollection', features: [], meta: {} });
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

  it('serves protected area and hydro layers with bbox parsing and validation', async () => {
    const invalid = await request(app).get('/api/layers/nvr?bbox=bad');
    expect(invalid.status).toBe(400);

    const nvr = await request(app).get('/api/layers/nvr?bbox=18,59,19,60&limit=12');
    expect(nvr.status).toBe(200);
    expect(mocks.getProtectedAreaLayer).toHaveBeenCalledWith(validBbox, 12);

    const lakesInvalid = await request(app).get('/api/layers/hydro.lakes?bbox=bad');
    expect(lakesInvalid.status).toBe(400);

    const streams = await request(app).get('/api/layers/hydro.streams?bbox=18,59,19,60');
    expect(streams.status).toBe(200);
    expect(mocks.getHydroLayer).toHaveBeenCalledWith('streams', validBbox);
  });

  it('serves SGU and property layers and requires bbox where expected', async () => {
    const groundMissing = await request(app).get('/api/layers/sgu/grundlager');
    expect(groundMissing.status).toBe(400);

    const ground = await request(app).get('/api/layers/sgu/grundlager?bbox=18,59,19,60');
    expect(ground.status).toBe(200);
    expect(mocks.getSguGroundLayerLayer).toHaveBeenCalledWith(validBbox);

    const landslide = await request(app).get('/api/layers/sgu/jordskred-raviner?bbox=18,59,19,60');
    expect(landslide.status).toBe(200);
    expect(mocks.getSguLandslideLayer).toHaveBeenCalledWith(validBbox);

    const propertyMissing = await request(app).get('/api/layers/property');
    expect(propertyMissing.status).toBe(400);

    const property = await request(app).get('/api/layers/property?bbox=18,59,19,60');
    expect(property.status).toBe(200);
    expect(mocks.getPropertyLayer).toHaveBeenCalledWith(validBbox);
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
