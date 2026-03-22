import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTokenPair } from '../../server/security/auth';

const mocks = vi.hoisted(() => ({
  getMarkCoverLayer: vi.fn(),
  getTerrainData: vi.fn(),
  parseBbox: vi.fn(),
}));

vi.mock('../../server/repositories/tokenRepository', () => ({
  isTokenRevoked: vi.fn(async () => false),
  markRefreshTokenAsUsed: vi.fn(async () => undefined),
  revokeRefreshToken: vi.fn(async () => undefined),
  cleanupExpiredTokenRevocations: vi.fn(async () => 0),
}));

vi.mock('../../server/services/publicUiService', () => ({
  parseBbox: mocks.parseBbox,
}));

vi.mock('../../server/services/markCoverService', () => ({
  getMarkCoverLayer: mocks.getMarkCoverLayer,
}));

vi.mock('../../server/services/terrainService', () => ({
  getTerrainData: mocks.getTerrainData,
}));

import geoRoutes from '../../server/routes/geo.routes';

const app = express();
app.use(express.json());
app.use(geoRoutes);

function authHeader() {
  return `Bearer ${
    createTokenPair({
      id: 'admin-1',
      organisationId: 'org-1',
      bankidId: 'admin:one',
      role: 'ADMIN',
    }).accessToken
  }`;
}

describe('geo.routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.parseBbox.mockReturnValue({
      minLng: 15.2,
      minLat: 60.1,
      maxLng: 15.4,
      maxLat: 60.3,
    });
    mocks.getMarkCoverLayer.mockResolvedValue({ type: 'FeatureCollection', features: [], source: 'postgis' });
    mocks.getTerrainData.mockResolvedValue({ points: [], resolution: 32, source: 'synthetic' });
  });

  it('rejects invalid bbox values for mark cover requests', async () => {
    mocks.parseBbox.mockReturnValueOnce(null);

    const res = await request(app).get('/api/geo/markcover?bbox=bad').set('Authorization', authHeader());

    expect(res.status).toBe(400);
    expect(String(res.body?.error || '')).toMatch(/bbox/i);
  });

  it('returns mark cover and terrain data for valid bbox input', async () => {
    const markcover = await request(app)
      .get('/api/geo/markcover?bbox=15.2,60.1,15.4,60.3')
      .set('Authorization', authHeader());

    expect(markcover.status).toBe(200);
    expect(mocks.getMarkCoverLayer).toHaveBeenCalledWith({
      minLng: 15.2,
      minLat: 60.1,
      maxLng: 15.4,
      maxLat: 60.3,
    });

    const terrain = await request(app)
      .get('/api/geo/terrain?bbox=15.2,60.1,15.4,60.3&resolution=64')
      .set('Authorization', authHeader());

    expect(terrain.status).toBe(200);
    expect(mocks.getTerrainData).toHaveBeenCalledWith(
      {
        minLng: 15.2,
        minLat: 60.1,
        maxLng: 15.4,
        maxLat: 60.3,
      },
      64,
    );
  });

  it('uses the default terrain resolution and surfaces service failures', async () => {
    const terrain = await request(app)
      .get('/api/geo/terrain?bbox=15.2,60.1,15.4,60.3')
      .set('Authorization', authHeader());

    expect(terrain.status).toBe(200);
    expect(mocks.getTerrainData).toHaveBeenCalledWith(
      {
        minLng: 15.2,
        minLat: 60.1,
        maxLng: 15.4,
        maxLat: 60.3,
      },
      32,
    );

    mocks.getMarkCoverLayer.mockRejectedValueOnce(new Error('mark cover failed'));
    const failed = await request(app)
      .get('/api/geo/markcover?bbox=15.2,60.1,15.4,60.3')
      .set('Authorization', authHeader());

    expect(failed.status).toBe(400);
    expect(String(failed.body?.error || '')).toBe('An error occurred processing your request');
  });
});
