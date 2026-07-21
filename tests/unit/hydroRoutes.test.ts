import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createTokenPair } from '../../server/security/auth';

vi.mock('../../server/repositories/tokenRepository', () => ({
  isTokenRevoked: vi.fn(async () => false),
  markRefreshTokenAsUsed: vi.fn(async () => undefined),
  revokeRefreshToken: vi.fn(async () => undefined),
  cleanupExpiredTokenRevocations: vi.fn(async () => 0),
}));

import hydroRoutes from '../../server/routes/hydro.routes';

const app = express();
app.use(express.json());
app.use(hydroRoutes);

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

describe('hydro.routes', () => {
  it('rejects unauthenticated requests', async () => {
    const p110 = await request(app)
      .post('/api/hydro/svenskt-vatten/p110')
      .send({
        areaM2: 5000,
        runoffCoefficient: 0.8,
        returnPeriodYears: 5,
        durationMinutes: 15,
        climateFactor: 1.25,
      });
    expect(p110.status).toBe(401);

    const klimat = await request(app)
      .post('/api/hydro/svenskt-vatten/klimat-va')
      .send({
        trenchLengthM: 100,
        trenchWidthM: 1,
        trenchDepthM: 1.5,
        reusePercentage: 50,
        pipes: [],
        transportDistanceKm: 15,
      });
    expect(klimat.status).toBe(401);
  });

  it('calculates P110 stormwater dimensions for valid input', async () => {
    const res = await request(app)
      .post('/api/hydro/svenskt-vatten/p110')
      .set('Authorization', authHeader())
      .send({
        areaM2: 10000,
        runoffCoefficient: 0.5,
        returnPeriodYears: 5,
        durationMinutes: 10,
        climateFactor: 1.25,
        allowedOutflowLs: 10.0,
      });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.result.dimensioningFlowLs).toBeGreaterThan(0);
    expect(res.body.result.maxRequiredVolumeM3).toBeGreaterThan(0);
    expect(res.body.result.volumeCurve).toHaveLength(16);
  });

  it('rejects P110 stormwater requests with missing parameters', async () => {
    const res = await request(app)
      .post('/api/hydro/svenskt-vatten/p110')
      .set('Authorization', authHeader())
      .send({
        areaM2: 10000,
        runoffCoefficient: 0.5,
        // returnPeriodYears is missing
        durationMinutes: 10,
        climateFactor: 1.25,
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it('calculates VA construction project climate footprint for valid input', async () => {
    const res = await request(app)
      .post('/api/hydro/svenskt-vatten/klimat-va')
      .set('Authorization', authHeader())
      .send({
        trenchLengthM: 200,
        trenchWidthM: 1.2,
        trenchDepthM: 1.8,
        reusePercentage: 60,
        pipes: [
          {
            material: 'PVC',
            diameterMm: 220,
            lengthM: 200,
          }
        ],
        transportDistanceKm: 15,
      });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.result.excavationEmissionsKgCo2e).toBeGreaterThan(0);
    expect(res.body.result.pipeMaterialEmissionsKgCo2e).toBeGreaterThan(0);
    expect(res.body.result.totalEmissionsKgCo2e).toBeGreaterThan(0);
    expect(res.body.result.summary.totalPipeWeightKg).toBeGreaterThan(0);
  });

  it('rejects VA construction project climate requests with missing parameters', async () => {
    const res = await request(app)
      .post('/api/hydro/svenskt-vatten/klimat-va')
      .set('Authorization', authHeader())
      .send({
        trenchLengthM: 200,
        // trenchWidthM is missing
        trenchDepthM: 1.8,
        reusePercentage: 60,
        pipes: [],
        transportDistanceKm: 15,
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });
});
