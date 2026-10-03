import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTokenPair } from '../../server/security/auth';

const mocks = vi.hoisted(() => ({
  lookupPropertyByDesignationFromPostgis: vi.fn(),
}));

vi.mock('../../server/repositories/tokenRepository', () => ({
  isTokenRevoked: vi.fn(async () => false),
  markRefreshTokenAsUsed: vi.fn(async () => undefined),
  revokeRefreshToken: vi.fn(async () => undefined),
  cleanupExpiredTokenRevocations: vi.fn(async () => 0),
}));

vi.mock('../../server/services/propertyUnitService', () => ({
  lookupPropertyByDesignationFromPostgis: mocks.lookupPropertyByDesignationFromPostgis,
}));

import propertyRoutes, { propertyLookupFailure } from '../../server/routes/property.routes';
import { SecureError } from '../../server/security/secureErrors';

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
    process.env.PROPERTY_LOOKUP_MODE = 'postgis';
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

  it('looks up properties via PostGIS for authenticated users', async () => {
    const res = await request(app)
      .post('/api/property/lookup')
      .set('Authorization', authHeader())
      .send({ projectId: 'project-1', propertyDesignation: 'Orsa 1:1', purpose: 'lookup' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      ok: true,
      result: {
        designation: 'Orsa 1:1',
        source: 'postgis',
      },
      source: 'postgis',
    });
    expect(mocks.lookupPropertyByDesignationFromPostgis).toHaveBeenCalledWith(
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
    expect(mocks.lookupPropertyByDesignationFromPostgis).toHaveBeenCalledWith(
      { projectId: 'project-1', propertyDesignation: 'GÄVLE 1:1', purpose: 'API_LOOKUP' },
      expect.objectContaining({ id: 'admin-1' }),
    );
  });

  it('rejects live mode fail-closed without calling PostGIS live LM', async () => {
    process.env.PROPERTY_LOOKUP_MODE = 'live';

    const res = await request(app)
      .post('/api/property/lookup')
      .set('Authorization', authHeader())
      .send({ projectId: 'project-1', propertyDesignation: 'Orsa 1:1', purpose: 'lookup' });

    expect(res.status).toBe(503);
    expect(res.body?.code).toBe('LIVE_LANTMATERIET_DISABLED');
    expect(String(res.body?.error || '')).toMatch(/avstängt|PostGIS/i);
    expect(mocks.lookupPropertyByDesignationFromPostgis).not.toHaveBeenCalled();
  });

  it('rejects api mode the same as live', async () => {
    process.env.PROPERTY_LOOKUP_MODE = 'api';

    const res = await request(app)
      .post('/api/property/lookup')
      .set('Authorization', authHeader())
      .send({ projectId: 'project-1', propertyDesignation: 'Orsa 1:1', purpose: 'lookup' });

    expect(res.status).toBe(503);
    expect(res.body?.code).toBe('LIVE_LANTMATERIET_DISABLED');
    // W-TEXT2 (3): a configuration refusal is not healed by a retry.
    expect(res.body?.retryable).toBe(false);
  });

  it('looks up properties from PostGIS and surfaces service errors safely', async () => {
    const success = await request(app)
      .post('/api/property/lookup/postgis')
      .set('Authorization', authHeader())
      .send({ projectId: 'project-1', propertyDesignation: 'Orsa 1:1', purpose: 'lookup' });

    expect(success.status).toBe(200);
    expect(success.body?.result?.source).toBe('postgis');

    // W-TEXT2 (3; U20CDF6 report 7): an unknown failure while READING is a read fault of unknown persistence -- 503 and
    // retryable true (the read-fault doctrine), never a 400 that blames the request. The raw message is never shown.
    mocks.lookupPropertyByDesignationFromPostgis.mockRejectedValueOnce(new Error('postgis lookup failed'));
    const failure = await request(app)
      .post('/api/property/lookup/postgis')
      .set('Authorization', authHeader())
      .send({ projectId: 'project-1', propertyDesignation: 'Orsa 1:1', purpose: 'lookup' });

    expect(failure.status).toBe(503);
    expect(failure.body).toEqual({
      ok: false,
      error: 'Fastighetsuppslaget kunde inte genomföras på grund av ett tekniskt fel. Ett nytt försök kan lyckas.',
      retryable: true,
    });
  });

  it('W-TEXT2 (3): a database read fault on both lookup routes -> 503, retryable true; no raw message, no code', async () => {
    for (const path of ['/api/property/lookup', '/api/property/lookup/postgis']) {
      mocks.lookupPropertyByDesignationFromPostgis.mockRejectedValueOnce(
        Object.assign(new Error("Can't reach database server at db.internal:5432"), { name: 'PrismaClientInitializationError' }),
      );
      const res = await request(app)
        .post(path)
        .set('Authorization', authHeader())
        .send({ projectId: 'project-1', propertyDesignation: 'Orsa 1:1', purpose: 'lookup' });
      expect(res.status, path).toBe(503);
      expect(res.body.retryable, path).toBe(true);
      expect(JSON.stringify(res.body), path).not.toMatch(/db\.internal|5432|Prisma/);
      expect(res.body).not.toHaveProperty('code');
    }
  });

  it('W-TEXT2 (3): proven invalid input stays 400, retryable false (the request itself is wrong)', async () => {
    const invalid = [
      'projectId, propertyDesignation and purpose are required', // server/security/projectAccess.ts validatePropertyLookupInput
      'Bulk or wildcard property lookup is not allowed', // validatePropertyLookupInput
    ];
    for (const message of invalid) {
      mocks.lookupPropertyByDesignationFromPostgis.mockRejectedValueOnce(new Error(message));
      const res = await request(app)
        .post('/api/property/lookup')
        .set('Authorization', authHeader())
        .send({ projectId: 'project-1', propertyDesignation: 'Orsa 1:1', purpose: 'lookup' });
      expect(res.status, message).toBe(400);
      expect(res.body.retryable, message).toBe(false);
    }
    // The route's own normaliser (server/security/propertyLookupNormalize.ts): no body at all -- Express 5 leaves
    // req.body undefined when nothing was parsed. (A JSON body that is no object never reaches the route: the strict
    // body parser answers that 400 itself, before any handler.)
    const callsBefore = mocks.lookupPropertyByDesignationFromPostgis.mock.calls.length;
    const noBody = await request(app).post('/api/property/lookup').set('Authorization', authHeader());
    expect(noBody.status).toBe(400);
    expect(noBody.body).toMatchObject({ ok: false, retryable: false });
    // The normaliser refused before the lookup: no further call to the service.
    expect(mocks.lookupPropertyByDesignationFromPostgis.mock.calls.length).toBe(callsBefore);
  });

  describe('W-TEXT2 (3): propertyLookupFailure (pure) -- the branches the HTTP cases above do not reach', () => {
    it('a typed SecureError below 500 (the shape of PROPERTY_LOOKUP_AMBIGUOUS, 409) keeps the 400 answer with its public text and code, retryable false', () => {
      const ambiguous = new SecureError('2 rows matched', 'Fastighetsbeteckningen matchar flera fastighetsytor. Ingen fastighet valdes.', 409, 'PROPERTY_LOOKUP_AMBIGUOUS');
      expect(propertyLookupFailure(ambiguous)).toEqual({
        status: 400,
        body: { ok: false, error: 'Fastighetsbeteckningen matchar flera fastighetsytor. Ingen fastighet valdes.', code: 'PROPERTY_LOOKUP_AMBIGUOUS', retryable: false },
      });
    });
    it('a typed SecureError of 500 or above keeps its public text as 503, retryable false (a deliberate refusal promises nothing)', () => {
      expect(propertyLookupFailure(new SecureError('db exploded', 'Tjänsten är tillfälligt otillgänglig.', 503))).toEqual({
        status: 503,
        body: { ok: false, error: 'Tjänsten är tillfälligt otillgänglig.', code: '503', retryable: false },
      });
      expect(propertyLookupFailure(new SecureError('internal detail'))).toEqual({
        status: 503,
        body: { ok: false, error: 'Internal server error', code: '500', retryable: false },
      });
    });
    it('a non-Error throw is a read fault of unknown persistence: 503, retryable true, the neutral Swedish text', () => {
      expect(propertyLookupFailure('plain-string-error')).toEqual({
        status: 503,
        body: { ok: false, error: 'Fastighetsuppslaget kunde inte genomföras på grund av ett tekniskt fel. Ett nytt försök kan lyckas.', retryable: true },
      });
    });
  });

  it('W-TEXT2 (3): a denial behind the lookup keeps its answer, retryable false', async () => {
    mocks.lookupPropertyByDesignationFromPostgis.mockRejectedValueOnce(new Error('Insufficient role permissions'));
    const res = await request(app)
      .post('/api/property/lookup')
      .set('Authorization', authHeader())
      .send({ projectId: 'project-1', propertyDesignation: 'Orsa 1:1', purpose: 'lookup' });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ ok: false, error: 'Access denied', retryable: false });
  });

  describe('postgis / hybrid mode (ingen live-fallback)', () => {
    beforeEach(() => {
      process.env.PROPERTY_LOOKUP_MODE = 'hybrid';
      mocks.lookupPropertyByDesignationFromPostgis.mockResolvedValue({
        designation: 'Test 1:1',
        source: 'postgis',
        geometry: { type: 'Polygon', coordinates: [] },
      });
    });

    it('använder endast PostGIS', async () => {
      const res = await request(app)
        .post('/api/property/lookup')
        .set('Authorization', authHeader())
        .send({ projectId: 'project-1', propertyDesignation: 'TEST 1:1', purpose: 'lookup' });

      expect(res.status).toBe(200);
      expect(res.body.source).toBe('postgis');
      expect(res.body.result?.source).toBe('postgis');
      expect(mocks.lookupPropertyByDesignationFromPostgis).toHaveBeenCalled();
    });

    it('returnerar LOCAL_PROPERTY_NOT_FOUND när PostGIS saknar träff', async () => {
      mocks.lookupPropertyByDesignationFromPostgis.mockRejectedValueOnce(
        new Error('Fastighet hittades inte i PostGIS: TEST 1:1'),
      );

      const res = await request(app)
        .post('/api/property/lookup')
        .set('Authorization', authHeader())
        .send({ projectId: 'project-1', propertyDesignation: 'TEST 1:1', purpose: 'lookup' });

      expect(res.status).toBe(400);
      expect(res.body?.code).toBe('LOCAL_PROPERTY_NOT_FOUND');
      // W-TEXT2 (3): an absence is not healed by a retry -- explicitly false.
      expect(res.body?.retryable).toBe(false);
    });
  });
});
