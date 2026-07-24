import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTokenPair } from '../../server/security/auth';

const mocks = vi.hoisted(() => ({
  getProjectForCarbonView: vi.fn(),
  getProjectEnvironmentalOnly: vi.fn(),
}));

vi.mock('../../server/repositories/tokenRepository', () => ({
  isTokenRevoked: vi.fn(async () => false),
  markRefreshTokenAsUsed: vi.fn(async () => undefined),
  revokeRefreshToken: vi.fn(async () => undefined),
  cleanupExpiredTokenRevocations: vi.fn(async () => 0),
}));

vi.mock('../../server/repositories/projectAccessRepository', () => ({
  assertProjectMembership: vi.fn(async () => undefined),
}));

vi.mock('../../server/security/auditTrail', () => ({
  appendDomainAudit: vi.fn(async () => undefined),
}));

vi.mock('../../server/services/projectPlanService', () => ({
  calculateCarbonForProject: vi.fn(
    async ({
      carbonInput,
    }: {
      carbonInput: { tons?: number; distanceKm?: number; emissionFactorKgCo2ePerTonKm?: number };
    }) => {
      const tons = Number(carbonInput.tons || 0);
      const distanceKm = Number(carbonInput.distanceKm || 0);
      const factor = Number(carbonInput.emissionFactorKgCo2ePerTonKm || 0.1);
      const transportKgCo2e = tons * distanceKm * factor;
      return {
        plan: { id: 'plan-1' },
        result: {
          totalKgCo2e: transportKgCo2e,
          breakdown: { transportKgCo2e },
          quality: 'ROUTED',
          method: 'LOCAL_DISTANCE',
        },
      };
    },
  ),
}));

vi.mock('../../server/modules/platform/public', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../server/modules/platform/public')>();
  return {
    ...mod,
    getProjectForCarbonView: mocks.getProjectForCarbonView,
    getProjectEnvironmentalOnly: mocks.getProjectEnvironmentalOnly,
  };
});

import adminCarbonRoutes from '../../server/routes/project.v1.routes';

const app = express();
app.use(express.json());
app.use(adminCarbonRoutes);

function authHeader() {
  return `Bearer ${
    createTokenPair({
      id: 'user-1',
      organisationId: 'org-1',
      bankidId: 'user:one',
      role: 'ADMIN',
    }).accessToken
  }`;
}

const mockProject = {
  id: 'proj-1',
  propertyDesignation: 'GÄVLE BRYNÄS 1:1',
  environmentalScore: 70,
  complianceScore: 85,
  regulatoryRiskScore: 30,
};

describe('admin.carbon routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getProjectForCarbonView.mockResolvedValue(mockProject);
    mocks.getProjectEnvironmentalOnly.mockResolvedValue(mockProject);
  });

  describe('GET /api/projects/:projectId/carbon', () => {
    it('returnerar koldata för ett projekt', async () => {
      const res = await request(app).get('/api/projects/proj-1/carbon').set('Authorization', authHeader());

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.carbonResult).toBeDefined();
      expect(res.body.esgRating).toBeDefined();
      expect(res.body.riskMetrics).toBeDefined();
    });

    it('returnerar 404 om projektet inte hittas', async () => {
      mocks.getProjectForCarbonView.mockResolvedValue(null);

      const res = await request(app).get('/api/projects/proj-99/carbon').set('Authorization', authHeader());

      expect(res.status).toBe(404);
      expect(res.body.ok).toBe(false);
    });

    it('beräknar kolmängd baserat på environmentalScore', async () => {
      const res = await request(app).get('/api/projects/proj-1/carbon').set('Authorization', authHeader());

      // environmentalScore = 70, so totalKgCo2e = 70 * 100 = 7000
      expect(res.body.carbonResult.totalKgCo2e).toBe(7000);
    });

    it('sätter ESG-rating till A om kolutsläpp < 5000', async () => {
      mocks.getProjectForCarbonView.mockResolvedValue({ ...mockProject, environmentalScore: 40 });

      const res = await request(app).get('/api/projects/proj-1/carbon').set('Authorization', authHeader());

      // environmentalScore = 40, totalKgCo2e = 4000 < 5000 → ESG A
      expect(res.body.esgRating.overall).toBe('A');
    });

    it('sätter carbonResult till null när miljöpoäng saknas', async () => {
      mocks.getProjectForCarbonView.mockResolvedValue({
        ...mockProject,
        environmentalScore: null,
        complianceScore: null,
        regulatoryRiskScore: null,
      });

      const res = await request(app).get('/api/projects/proj-1/carbon').set('Authorization', authHeader());

      expect(res.status).toBe(200);
      expect(res.body.carbonResult).toBeNull();
    });

    it('returnerar 401 utan autentisering', async () => {
      const res = await request(app).get('/api/projects/proj-1/carbon');
      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/projects/:projectId/carbon/calculate', () => {
    it('beräknar koldioxidavtryck för lastbilstransport', async () => {
      const res = await request(app)
        .post('/api/projects/proj-1/carbon/calculate')
        .set('Authorization', authHeader())
        .send({
          carbonInput: {
            tons: 10,
            distanceKm: 100,
            emissionFactorKgCo2ePerTonKm: 3.72,
            materialKgCo2e: 1860,
          },
        });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.result.breakdown.transport).toBe(3720);
      expect(res.body.result.breakdown.material).toBe(1860);
    });

    it('beräknar koldioxidavtryck med lägre transportintensitet', async () => {
      const res = await request(app)
        .post('/api/projects/proj-1/carbon/calculate')
        .set('Authorization', authHeader())
        .send({
          carbonInput: {
            tons: 5,
            distanceKm: 100,
            emissionFactorKgCo2ePerTonKm: 3.72,
            materialKgCo2e: 930,
          },
        });

      expect(res.status).toBe(200);
      expect(res.body.result.breakdown.transport).toBe(1860);
      expect(res.body.result.breakdown.material).toBe(930);
    });

    it('returnerar 404 om projektet inte hittas', async () => {
      mocks.getProjectEnvironmentalOnly.mockResolvedValue(null);

      const res = await request(app)
        .post('/api/projects/proj-99/carbon/calculate')
        .set('Authorization', authHeader())
        .send({ carbonInput: {} });

      expect(res.status).toBe(404);
    });

    it('returnerar 401 utan autentisering', async () => {
      const res = await request(app).post('/api/projects/proj-1/carbon/calculate').send({ carbonInput: {} });

      expect(res.status).toBe(401);
    });
  });
});
