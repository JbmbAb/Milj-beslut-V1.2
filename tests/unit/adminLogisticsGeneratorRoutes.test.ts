import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTokenPair } from '../../server/security/auth';

const mocks = vi.hoisted(() => ({
  generateLogisticsPlan: vi.fn(),
}));

vi.mock('../../server/repositories/tokenRepository', () => ({
  isTokenRevoked: vi.fn(async () => false),
  markRefreshTokenAsUsed: vi.fn(async () => undefined),
  revokeRefreshToken: vi.fn(async () => undefined),
  cleanupExpiredTokenRevocations: vi.fn(async () => 0),
}));

vi.mock('../../server/services/logisticsGeneratorService', () => ({
  generateLogisticsPlan: mocks.generateLogisticsPlan,
}));

vi.mock('../../server/repositories/projectAccessRepository', () => ({
  assertProjectMembership: vi.fn(async () => undefined),
}));

import generatorRoutes from '../../server/routes/generators.routes';

const app = express();
app.use(express.json());
app.use(generatorRoutes);

function authHeader() {
  return `Bearer ${
    createTokenPair({
      id: 'user-1',
      organisationId: 'org-1',
      bankidId: 'user:one',
      role: 'CONSULTANT',
    }).accessToken
  }`;
}

const mockPlan = {
  id: 'logistics-proj-1-1234567890',
  projectId: 'proj-1',
  wasteType: 'Förorenade massor',
  estimatedTons: 500,
  transportMode: 'TRUCK',
  routeSegments: [],
  requiredPermits: [],
  estimatedCost: { total: 250000, currency: 'SEK', breakdown: {} },
  generatedAt: new Date().toISOString(),
};

describe('admin.logistics-generator routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.generateLogisticsPlan.mockResolvedValue(mockPlan);
  });

  describe('POST /api/projects/:projectId/logistics/generate', () => {
    it('genererar logistikplan för masshantering', async () => {
      const res = await request(app)
        .post('/api/projects/proj-1/logistics/generate')
        .set('Authorization', authHeader())
        .send({
          wasteType: 'Förorenade massor',
          estimatedTons: 500,
          sourceAddress: 'Brynäsgatan 1, Gävle',
          destinationAddress: 'Deponi Enköping',
          transportMode: 'TRUCK',
        });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.plan.id).toBe(mockPlan.id);
      expect(res.body.plan.transportMode).toBe('TRUCK');
    });

    it('skickar korrekt request med contaminants', async () => {
      await request(app)
        .post('/api/projects/proj-1/logistics/generate')
        .set('Authorization', authHeader())
        .send({
          wasteType: 'Förorenade massor',
          estimatedTons: 500,
          sourceAddress: 'Brynäsgatan 1, Gävle',
          destinationAddress: 'Deponi Enköping',
          transportMode: 'TRUCK',
          contaminants: ['bly', 'arsenik'],
          tillståndsId: 'tillstand-123',
        });

      expect(mocks.generateLogisticsPlan).toHaveBeenCalledWith(
        expect.objectContaining({
          contaminants: ['bly', 'arsenik'],
          tillståndsId: 'tillstand-123',
          estimatedTons: 500,
        }),
      );
    });

    it('sätter contaminants till tom lista om ej angiven', async () => {
      await request(app)
        .post('/api/projects/proj-1/logistics/generate')
        .set('Authorization', authHeader())
        .send({
          wasteType: 'Förorenade massor',
          estimatedTons: 500,
          sourceAddress: 'Brynäsgatan 1',
          destinationAddress: 'Deponi',
          transportMode: 'TRUCK',
        });

      expect(mocks.generateLogisticsPlan).toHaveBeenCalledWith(expect.objectContaining({ contaminants: [] }));
    });

    it('returnerar 400 om required fields saknas', async () => {
      const res = await request(app)
        .post('/api/projects/proj-1/logistics/generate')
        .set('Authorization', authHeader())
        .send({ wasteType: 'Förorenade massor' }); // Missing other fields

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Missing required fields');
    });

    it('returnerar 400 vid service-fel', async () => {
      mocks.generateLogisticsPlan.mockRejectedValue(new Error('Gemini API timeout'));

      const res = await request(app)
        .post('/api/projects/proj-1/logistics/generate')
        .set('Authorization', authHeader())
        .send({
          wasteType: 'Förorenade massor',
          estimatedTons: 500,
          sourceAddress: 'Brynäsgatan 1',
          destinationAddress: 'Deponi',
          transportMode: 'TRUCK',
        });

      expect(res.status).toBe(400);
    });

    it('returnerar 401 utan autentisering', async () => {
      const res = await request(app).post('/api/projects/proj-1/logistics/generate').send({
        wasteType: 'Test',
        estimatedTons: 100,
        sourceAddress: 'X',
        destinationAddress: 'Y',
        transportMode: 'TRUCK',
      });

      expect(res.status).toBe(401);
    });

    it('konverterar estimatedTons till nummer', async () => {
      await request(app)
        .post('/api/projects/proj-1/logistics/generate')
        .set('Authorization', authHeader())
        .send({
          wasteType: 'Förorenade massor',
          estimatedTons: '250',
          sourceAddress: 'Brynäsgatan 1',
          destinationAddress: 'Deponi',
          transportMode: 'RAIL',
        });

      expect(mocks.generateLogisticsPlan).toHaveBeenCalledWith(
        expect.objectContaining({ estimatedTons: 250, transportMode: 'RAIL' }),
      );
    });

    it('skickar tillståndsId till service', async () => {
      await request(app)
        .post('/api/projects/proj-1/logistics/generate')
        .set('Authorization', authHeader())
        .send({
          wasteType: 'Förorenade massor',
          estimatedTons: 100,
          sourceAddress: 'Brynäsgatan 1',
          destinationAddress: 'Deponi',
          transportMode: 'TRUCK',
          tillståndsId: 'tillstand-abc',
        });

      expect(mocks.generateLogisticsPlan).toHaveBeenCalledWith(
        expect.objectContaining({ tillståndsId: 'tillstand-abc' }),
      );
    });

    it('returnerar genererad plan med korrekt struktur', async () => {
      const res = await request(app)
        .post('/api/projects/proj-1/logistics/generate')
        .set('Authorization', authHeader())
        .send({
          wasteType: 'Förorenade massor',
          estimatedTons: 500,
          sourceAddress: 'Brynäsgatan 1, Gävle',
          destinationAddress: 'Deponi Enköping',
          transportMode: 'TRUCK',
        });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.plan).toBeDefined();
      expect(res.body.plan.projectId).toBe('proj-1');
    });
  });
});
