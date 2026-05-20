import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTokenPair } from '../../server/security/auth';

const mocks = vi.hoisted(() => ({
  lookupPropertyByDesignation: vi.fn(),
  lookupPropertyByDesignationFromPostgis: vi.fn(),
}));

vi.mock('../../server/repositories/tokenRepository', () => ({
  isTokenRevoked: vi.fn(async () => false),
  markRefreshTokenAsUsed: vi.fn(async () => undefined),
  revokeRefreshToken: vi.fn(async () => undefined),
  cleanupExpiredTokenRevocations: vi.fn(async () => 0),
}));

vi.mock('../../server/services/lantmaterietService', () => ({
  lookupPropertyByDesignation: mocks.lookupPropertyByDesignation,
}));

vi.mock('../../server/services/propertyUnitService', () => ({
  lookupPropertyByDesignationFromPostgis: mocks.lookupPropertyByDesignationFromPostgis,
}));

import propertyRoutes from '../../server/routes/property.routes';

const app = express();
app.use(express.json());
app.use(propertyRoutes);

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

describe('property.routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Undvik att PostGIS alltid vinner över mockade live-anrop i dessa tester.
    process.env.PROPERTY_LOOKUP_MODE = 'live';
    mocks.lookupPropertyByDesignation.mockResolvedValue({
      designation: 'Orsa 1:1',
      source: 'lantmateriet',
    });
    mocks.lookupPropertyByDesignationFromPostgis.mockResolvedValue({
      designation: 'Orsa 1:1',
      source: 'postgis',
    });
  });

  it('requires bearer auth for property lookups', async () => {
    const res = await request(app)
      .post('/api/property/lookup')
      .send({ projectId: 'project-1', propertyDesignation: 'Orsa 1:1', purpose: 'lookup' });

    expect(res.status).toBe(401);
  });

  it('requires bearer auth for PostGIS lookups', async () => {
    const res = await request(app)
      .post('/api/property/lookup/postgis')
      .send({ projectId: 'project-1', propertyDesignation: 'Orsa 1:1', purpose: 'lookup' });

    expect(res.status).toBe(401);
  });

  it('looks up properties via Lantmateriet for authenticated users', async () => {
    const res = await request(app)
      .post('/api/property/lookup')
      .set('Authorization', authHeader())
      .send({ projectId: 'project-1', propertyDesignation: 'Orsa 1:1', purpose: 'lookup' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      ok: true,
      result: {
        designation: 'Orsa 1:1',
        source: 'lantmateriet',
      },
      source: 'live',
    });
    expect(mocks.lookupPropertyByDesignation).toHaveBeenCalledWith(
      { projectId: 'project-1', propertyDesignation: 'Orsa 1:1', purpose: 'lookup' },
      expect.objectContaining({ id: 'admin-1' }),
    );
  });

  it('accepts legacy designation field and default purpose API_LOOKUP', async () => {
    const res = await request(app)
      .post('/api/property/lookup')
      .set('Authorization', authHeader())
      .send({ projectId: 'project-1', designation: 'GÄVLE 1:1' });

    expect(res.status).toBe(200);
    expect(mocks.lookupPropertyByDesignation).toHaveBeenCalledWith(
      { projectId: 'project-1', propertyDesignation: 'GÄVLE 1:1', purpose: 'API_LOOKUP' },
      expect.objectContaining({ id: 'admin-1' }),
    );
  });

  it('returns 400 on Lantmateriet service error', async () => {
    mocks.lookupPropertyByDesignation.mockRejectedValueOnce(new Error('Lantmäteriet timeout'));

    const res = await request(app)
      .post('/api/property/lookup')
      .set('Authorization', authHeader())
      .send({ projectId: 'project-1', propertyDesignation: 'GÄVLE BRYNÄS 1:1', purpose: 'lookup' });

    expect(res.status).toBe(400);
    expect(String(res.body?.error || '')).toBe('An error occurred processing your request');
  });

  it('returns a clear fail-closed error when live Lantmateriet is required', async () => {
    mocks.lookupPropertyByDesignation.mockRejectedValueOnce(
      new Error('LIVE_LANTMATERIET_REQUIRED: live credentials missing'),
    );

    const res = await request(app)
      .post('/api/property/lookup')
      .set('Authorization', authHeader())
      .send({ projectId: 'project-1', propertyDesignation: 'ORSA STACKMORA 3:12 (2)', purpose: 'lookup' });

    expect(res.status).toBe(400);
    expect(res.body?.code).toBe('LIVE_LANTMATERIET_REQUIRED');
    expect(String(res.body?.error || '')).toMatch(/live-uppslag/);
  });

  it('looks up properties from PostGIS and surfaces service errors safely', async () => {
    const success = await request(app)
      .post('/api/property/lookup/postgis')
      .set('Authorization', authHeader())
      .send({ projectId: 'project-1', propertyDesignation: 'Orsa 1:1', purpose: 'lookup' });

    expect(success.status).toBe(200);
    expect(success.body?.result?.source).toBe('postgis');

    mocks.lookupPropertyByDesignationFromPostgis.mockRejectedValueOnce(new Error('postgis lookup failed'));
    const failure = await request(app)
      .post('/api/property/lookup/postgis')
      .set('Authorization', authHeader())
      .send({ projectId: 'project-1', propertyDesignation: 'Orsa 1:1', purpose: 'lookup' });

    expect(failure.status).toBe(400);
    expect(String(failure.body?.error || '')).toBe('An error occurred processing your request');
  });

  describe('hybrid mode', () => {
    beforeEach(() => {
      process.env.PROPERTY_LOOKUP_MODE = 'hybrid';
      mocks.lookupPropertyByDesignationFromPostgis.mockResolvedValue(null);
      mocks.lookupPropertyByDesignation.mockResolvedValue({
        designation: 'Test 1:1',
        source: 'open-ogc',
        geometry: { type: 'Polygon', coordinates: [] },
      });
    });

    it('använder live-fallback när PostGIS saknar träff och markerar öppen OGC-källa', async () => {
      const res = await request(app)
        .post('/api/property/lookup')
        .set('Authorization', authHeader())
        .send({ projectId: 'project-1', propertyDesignation: 'TEST 1:1', purpose: 'lookup' });

      expect(res.status).toBe(200);
      expect(res.body.source).toBe('open-ogc-fallback');
      expect(res.body.result?.source).toBe('open-ogc');
      expect(mocks.lookupPropertyByDesignationFromPostgis).toHaveBeenCalled();
      expect(mocks.lookupPropertyByDesignation).toHaveBeenCalled();
    });
  });
});
