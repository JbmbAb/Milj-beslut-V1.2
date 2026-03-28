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
    });
    expect(mocks.lookupPropertyByDesignation).toHaveBeenCalledWith(
      { projectId: 'project-1', propertyDesignation: 'Orsa 1:1', purpose: 'lookup' },
      expect.objectContaining({ id: 'admin-1' }),
    );
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
});
