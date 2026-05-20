import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTokenPair } from '../../server/security/auth';

const mocks = vi.hoisted(() => ({
  generateProjectPlan: vi.fn(),
}));

vi.mock('../../server/repositories/tokenRepository', () => ({
  isTokenRevoked: vi.fn(async () => false),
  markRefreshTokenAsUsed: vi.fn(async () => undefined),
  revokeRefreshToken: vi.fn(async () => undefined),
  cleanupExpiredTokenRevocations: vi.fn(async () => 0),
}));

vi.mock('../../server/services/projectPlanGeneratorService', () => ({
  generateProjectPlan: mocks.generateProjectPlan,
}));

import adminProjectPlanGeneratorRoutes from '../../server/routes/admin.v1.routes';

const app = express();
app.use(express.json());
app.use(adminProjectPlanGeneratorRoutes);

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
  id: 'plan-proj-1-1234567890',
  projectId: 'proj-1',
  phases: [{ id: 'phase-1', name: 'Planering', status: 'TODO' }],
  risks: [],
  stakeholders: [],
  generatedAt: new Date().toISOString(),
};

/*
describe('admin.project-plan-generator routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.generateProjectPlan.mockResolvedValue(mockPlan);
  });

  describe('POST /api/projects/:projectId/plan/generate', () => {
    it('genererar projektplan med AI', async () => {
      const res = await request(app)
        .post('/api/projects/proj-1/plan/generate')
        .set('Authorization', authHeader())
        .send({
          propertyId: 'prop-1',
          projectType: 'CONSTRUCTION',
          budget: 500000,
          timeframe: '6 månader',
          description: 'Masshantering Gävle Brynäs',
        });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.plan.id).toBe(mockPlan.id);
    });

    it('skickar korrekt request till service', async () => {
      await request(app).post('/api/projects/proj-1/plan/generate').set('Authorization', authHeader()).send({
        propertyId: 'prop-1',
        projectType: 'CONSTRUCTION',
        budget: 500000,
        timeframe: '6 månader',
        description: 'Masshantering Gävle Brynäs',
        latitude: 60.67,
        longitude: 17.14,
      });

      expect(mocks.generateProjectPlan).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: 'proj-1',
          propertyId: 'prop-1',
          projectType: 'CONSTRUCTION',
          budget: 500000,
          latitude: 60.67,
          longitude: 17.14,
        }),
      );
    });

    it('returnerar 400 om required fields saknas', async () => {
      const res = await request(app)
        .post('/api/projects/proj-1/plan/generate')
        .set('Authorization', authHeader())
        .send({ propertyId: 'prop-1' }); // Missing projectType, budget, timeframe, description

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Missing required fields');
    });

    it('returnerar 400 vid service-fel', async () => {
      mocks.generateProjectPlan.mockRejectedValue(new Error('Gemini API-fel'));

      const res = await request(app)
        .post('/api/projects/proj-1/plan/generate')
        .set('Authorization', authHeader())
        .send({
          propertyId: 'prop-1',
          projectType: 'CONSTRUCTION',
          budget: 500000,
          timeframe: '6 månader',
          description: 'Masshantering',
        });

      expect(res.status).toBe(400);
    });

    it('returnerar 401 utan autentisering', async () => {
      const res = await request(app).post('/api/projects/proj-1/plan/generate').send({
        propertyId: 'prop-1',
        projectType: 'CONSTRUCTION',
        budget: 500000,
        timeframe: '6 månader',
        description: 'Test',
      });

      expect(res.status).toBe(401);
    });

    it('hanterar valfria koordinater', async () => {
      const res = await request(app)
        .post('/api/projects/proj-1/plan/generate')
        .set('Authorization', authHeader())
        .send({
          propertyId: 'prop-1',
          projectType: 'CONSTRUCTION',
          budget: 500000,
          timeframe: '6 månader',
          description: 'Masshantering',
          // No latitude/longitude
        });

      expect(res.status).toBe(200);
      expect(mocks.generateProjectPlan).toHaveBeenCalledWith(
        expect.objectContaining({ latitude: undefined, longitude: undefined }),
      );
    });

    it('konverterar budget till nummer', async () => {
      await request(app).post('/api/projects/proj-1/plan/generate').set('Authorization', authHeader()).send({
        propertyId: 'prop-1',
        projectType: 'CONSTRUCTION',
        budget: '750000',
        timeframe: '12 månader',
        description: 'Masshantering',
      });

      expect(mocks.generateProjectPlan).toHaveBeenCalledWith(expect.objectContaining({ budget: 750000 }));
    });

    it('kräver att projectType är med bland required fields', async () => {
      const res = await request(app)
        .post('/api/projects/proj-1/plan/generate')
        .set('Authorization', authHeader())
        .send({
          propertyId: 'prop-1',
          budget: 500000,
          timeframe: '6 månader',
          description: 'Masshantering',
          // Missing projectType
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Missing required fields');
    });
  });
});
*/
