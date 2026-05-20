import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTokenPair } from '../../server/security/auth';

const mocks = vi.hoisted(() => ({
  generatePermitApplication: vi.fn(),
}));

vi.mock('../../server/repositories/tokenRepository', () => ({
  isTokenRevoked: vi.fn(async () => false),
  markRefreshTokenAsUsed: vi.fn(async () => undefined),
  revokeRefreshToken: vi.fn(async () => undefined),
  cleanupExpiredTokenRevocations: vi.fn(async () => 0),
}));

vi.mock('../../server/services/permitApplicationGeneratorService', () => ({
  generatePermitApplication: mocks.generatePermitApplication,
}));

import adminPermitGeneratorRoutes from '../../server/routes/admin.v1.routes';

const app = express();
app.use(express.json());
app.use(adminPermitGeneratorRoutes);

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

const mockGeneratedApplication = {
  id: 'permit-proj-1-1234567890',
  projectId: 'proj-1',
  generatedAt: new Date().toISOString(),
  propertyDesignation: 'GÄVLE BRYNÄS 1:1',
  sniCode: '38.21.10',
  applicationSummary: { title: 'Tillståndsansökan', operationType: 'Miljöfarlig verksamhet' },
  riskAnalysis: [],
  stakeholderAnalysis: [],
  requiredDocuments: [],
  budgetEstimate: { estimatedCost: 500000, currency: 'SEK', categories: {} },
  environmentalImpact: { airQuality: 'Låg', waterQuality: 'Medel' },
  samplingAndLabPlan: [],
  recommendedLaboratories: [],
  complianceChecklist: [],
  sourceTracking: [],
  externalSourcesUsed: [],
};

/*
describe('admin.permit-generator routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.generatePermitApplication.mockResolvedValue(mockGeneratedApplication);
  });

  describe('POST /api/projects/:projectId/permit/generate', () => {
    it('genererar tillståndsansökan med AI', async () => {
      const res = await request(app)
        .post('/api/projects/proj-1/permit/generate')
        .set('Authorization', authHeader())
        .send({
          propertyDesignation: 'GÄVLE BRYNÄS 1:1',
          sniCode: '38.21.10',
          description: 'Hantering av farligt avfall',
          budget: 500000,
          latitude: 60.67,
          longitude: 17.14,
        });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.application.id).toBe(mockGeneratedApplication.id);
      expect(res.body.application.sniCode).toBe('38.21.10');
    });

    it('skickar korrekt request till service', async () => {
      await request(app)
        .post('/api/projects/proj-1/permit/generate')
        .set('Authorization', authHeader())
        .send({
          propertyDesignation: 'GÄVLE BRYNÄS 1:1',
          sniCode: '38.21.10',
          description: 'Hantering av farligt avfall',
        });

      expect(mocks.generatePermitApplication).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: 'proj-1',
          propertyDesignation: 'GÄVLE BRYNÄS 1:1',
          sniCode: '38.21.10',
        }),
      );
    });

    it('returnerar 400 om required fields saknas', async () => {
      const res = await request(app)
        .post('/api/projects/proj-1/permit/generate')
        .set('Authorization', authHeader())
        .send({ sniCode: '38.21.10' }); // Missing propertyDesignation and description

      expect(res.status).toBe(400);
      expect(res.body.ok).toBe(false);
      expect(res.body.error).toContain('Missing required fields');
    });

    it('returnerar 400 vid service-fel', async () => {
      mocks.generatePermitApplication.mockRejectedValue(new Error('Gemini API-fel'));

      const res = await request(app)
        .post('/api/projects/proj-1/permit/generate')
        .set('Authorization', authHeader())
        .send({
          propertyDesignation: 'GÄVLE BRYNÄS 1:1',
          sniCode: '38.21.10',
          description: 'Hantering av farligt avfall',
        });

      expect(res.status).toBe(400);
    });

    it('returnerar 401 utan autentisering', async () => {
      const res = await request(app)
        .post('/api/projects/proj-1/permit/generate')
        .send({ propertyDesignation: 'Test', sniCode: '38.21.10', description: 'Test' });

      expect(res.status).toBe(401);
    });

    it('hanterar tomma budget och koordinater', async () => {
      const res = await request(app)
        .post('/api/projects/proj-1/permit/generate')
        .set('Authorization', authHeader())
        .send({
          propertyDesignation: 'GÄVLE BRYNÄS 1:1',
          sniCode: '38.21.10',
          description: 'Hantering av farligt avfall',
          budget: '',
          latitude: '',
          longitude: '',
        });

      expect(res.status).toBe(200);
      // budget/lat/lng should be undefined when empty string
      expect(mocks.generatePermitApplication).toHaveBeenCalledWith(
        expect.objectContaining({
          budget: undefined,
          latitude: undefined,
          longitude: undefined,
        }),
      );
    });

    it('returnerar 400 om projectId saknas (tom sträng via routeParam)', async () => {
      // Express will not match the route without a projectId segment — 404 is expected
      const res = await request(app)
        .post('/api/projects//permit/generate')
        .set('Authorization', authHeader())
        .send({ propertyDesignation: 'Test', sniCode: '38.21.10', description: 'Test' });

      expect([400, 404]).toContain(res.status);
    });

    it('skickar budget och koordinater som nummer när ifyllda', async () => {
      await request(app)
        .post('/api/projects/proj-1/permit/generate')
        .set('Authorization', authHeader())
        .send({
          propertyDesignation: 'GÄVLE BRYNÄS 1:1',
          sniCode: '38.21.10',
          description: 'Hantering',
          budget: 750000,
          latitude: 60.67,
          longitude: 17.14,
        });

      expect(mocks.generatePermitApplication).toHaveBeenCalledWith(
        expect.objectContaining({ budget: 750000, latitude: 60.67, longitude: 17.14 }),
      );
    });

    it('hanterar valfri sniDescription', async () => {
      await request(app)
        .post('/api/projects/proj-1/permit/generate')
        .set('Authorization', authHeader())
        .send({
          propertyDesignation: 'GÄVLE BRYNÄS 1:1',
          sniCode: '38.21.10',
          sniDescription: 'Deponi klass II',
          description: 'Hantering av farligt avfall',
        });

      expect(mocks.generatePermitApplication).toHaveBeenCalledWith(
        expect.objectContaining({ sniDescription: 'Deponi klass II' }),
      );
    });
  });
});
*/
