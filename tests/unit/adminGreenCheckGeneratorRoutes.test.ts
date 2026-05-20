import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTokenPair } from '../../server/security/auth';

const mocks = vi.hoisted(() => ({
  generateGreenCheck: vi.fn(),
}));

vi.mock('../../server/repositories/tokenRepository', () => ({
  isTokenRevoked: vi.fn(async () => false),
  markRefreshTokenAsUsed: vi.fn(async () => undefined),
  revokeRefreshToken: vi.fn(async () => undefined),
  cleanupExpiredTokenRevocations: vi.fn(async () => 0),
}));

vi.mock('../../server/services/greenCheckGeneratorService', () => ({
  generateGreenCheck: mocks.generateGreenCheck,
}));

import adminGreenCheckGeneratorRoutes from '../../server/routes/admin.v1.routes';

const app = express();
app.use(express.json());
app.use(adminGreenCheckGeneratorRoutes);

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

const mockAssessment = {
  id: 'green-check-556677-1234567890',
  organizationNumber: '556677-8899',
  esgRating: 'B',
  euTaxonomyAlignment: 45,
  climateRisk: 'MEDIUM',
  recommendations: ['Minska koldioxidutsläpp med 30%'],
  generatedAt: new Date().toISOString(),
};

/*
describe('admin.green-check-generator routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.generateGreenCheck.mockResolvedValue(mockAssessment);
  });

  describe('POST /api/green-check/generate', () => {
    it('genererar ESG-bedömning för organisation', async () => {
      const res = await request(app)
        .post('/api/green-check/generate')
        .set('Authorization', authHeader())
        .send({
          organizationNumber: '556677-8899',
          organizationName: 'Gävle Miljöteknik AB',
          projectDescription: 'Sanering av industrimark',
          investmentAmount: 5000000,
          sector: 'REMEDIATION',
        });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.assessment.esgRating).toBe('B');
    });

    it('skickar korrekt request till service', async () => {
      await request(app).post('/api/green-check/generate').set('Authorization', authHeader()).send({
        organizationNumber: '556677-8899',
        organizationName: 'Gävle Miljöteknik AB',
        projectDescription: 'Sanering av industrimark',
        latitude: 60.67,
        longitude: 17.14,
      });

      expect(mocks.generateGreenCheck).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationNumber: '556677-8899',
          latitude: 60.67,
          longitude: 17.14,
        }),
      );
    });

    it('returnerar 400 om required fields saknas', async () => {
      const res = await request(app)
        .post('/api/green-check/generate')
        .set('Authorization', authHeader())
        .send({ organizationNumber: '556677-8899' }); // Missing projectDescription

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Missing required fields');
    });

    it('hanterar tomma investmentAmount och koordinater', async () => {
      const res = await request(app)
        .post('/api/green-check/generate')
        .set('Authorization', authHeader())
        .send({
          organizationNumber: '556677-8899',
          projectDescription: 'Sanering av industrimark',
          investmentAmount: '',
          latitude: '',
          longitude: '',
        });

      expect(res.status).toBe(200);
      expect(mocks.generateGreenCheck).toHaveBeenCalledWith(
        expect.objectContaining({
          investmentAmount: undefined,
          latitude: undefined,
          longitude: undefined,
        }),
      );
    });

    it('returnerar 400 vid service-fel', async () => {
      mocks.generateGreenCheck.mockRejectedValue(new Error('AI API timeout'));

      const res = await request(app)
        .post('/api/green-check/generate')
        .set('Authorization', authHeader())
        .send({
          organizationNumber: '556677-8899',
          projectDescription: 'Sanering av industrimark',
        });

      expect(res.status).toBe(400);
    });

    it('returnerar 401 utan autentisering', async () => {
      const res = await request(app)
        .post('/api/green-check/generate')
        .send({ organizationNumber: '556677-8899', projectDescription: 'Test' });

      expect(res.status).toBe(401);
    });

    it('skickar korrekt sector till service', async () => {
      await request(app).post('/api/green-check/generate').set('Authorization', authHeader()).send({
        organizationNumber: '556677-8899',
        organizationName: 'Gävle Miljöteknik AB',
        projectDescription: 'Sanering av industrimark',
        sector: 'ENERGY',
      });

      expect(mocks.generateGreenCheck).toHaveBeenCalledWith(expect.objectContaining({ sector: 'ENERGY' }));
    });

    it('hanterar numerisk investmentAmount korrekt', async () => {
      await request(app).post('/api/green-check/generate').set('Authorization', authHeader()).send({
        organizationNumber: '556677-8899',
        projectDescription: 'Sanering',
        investmentAmount: 2500000,
      });

      expect(mocks.generateGreenCheck).toHaveBeenCalledWith(
        expect.objectContaining({ investmentAmount: 2500000 }),
      );
    });

    it('returnerar genererad bedömning med korrekt struktur', async () => {
      const res = await request(app)
        .post('/api/green-check/generate')
        .set('Authorization', authHeader())
        .send({
          organizationNumber: '556677-8899',
          projectDescription: 'Sanering av industrimark',
        });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.assessment).toBeDefined();
      expect(res.body.assessment.organizationNumber).toBe('556677-8899');
    });
  });
});
*/
