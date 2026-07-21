import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTokenPair } from '../../server/security/auth';

const mocks = vi.hoisted(() => ({
  analyzeSewageProperty: vi.fn(),
  generateSewageProtectionProfile: vi.fn(),
}));

vi.mock('../../server/repositories/tokenRepository', () => ({
  isTokenRevoked: vi.fn(async () => false),
  markRefreshTokenAsUsed: vi.fn(async () => undefined),
  revokeRefreshToken: vi.fn(async () => undefined),
  cleanupExpiredTokenRevocations: vi.fn(async () => 0),
}));

vi.mock('../../server/services/sewageAnalysisService', () => ({
  analyzeSewageProperty: mocks.analyzeSewageProperty,
  generateSewageProtectionProfile: mocks.generateSewageProtectionProfile,
}));

import adminSewageAnalysisRoutes from '../../server/routes/admin.sewage-analysis';

const app = express();
app.use(express.json());
app.use(adminSewageAnalysisRoutes);

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

const mockGisAnalysis = {
  propertyId: 'prop-1',
  timestamp: new Date().toISOString(),
  overallRiskScore: 30,
  feasibilityScore: 80,
  recommendedSystems: ['INFILTRATION'],
  blockedSystems: [],
  reasoning: ['Isälvssand ger god infiltration'],
};

const mockProtectionProfile = {
  propertyId: 'prop-1',
  protectionLevel: 'NORMAL',
  nearestWell: { distance: 50, owner: 'NEIGHBOR', coordinates: { lat: 60.67, lng: 17.14 } },
  nearestWaterCourse: { distance: 100, type: 'Bäck', name: 'Källbäcken' },
  distanceToPropertyLine: 5,
  soilProfile: {
    soilType: 'Isälvssand',
    depthToRock: 5,
    groundwaterLevel: 2.5,
    infiltrationCapacity: 'HIGH',
    permeability: 50,
  },
  recommendedSystem: 'INFILTRATION',
};

describe('admin.sewage-analysis routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.analyzeSewageProperty.mockResolvedValue(mockGisAnalysis);
    mocks.generateSewageProtectionProfile.mockResolvedValue(mockProtectionProfile);
  });

  describe('POST /api/sewage/analyze', () => {
    it('analyserar fastighet för VA-anläggning', async () => {
      const res = await request(app).post('/api/sewage/analyze').set('Authorization', authHeader()).send({
        propertyDesignation: 'GÄVLE BRYNÄS 1:1',
        municipalityCode: '2180',
        latitude: 60.67,
        longitude: 17.14,
        pe: 5,
      });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.analysis.feasibilityScore).toBe(80);
      expect(res.body.protectionProfile.protectionLevel).toBe('NORMAL');
    });

    it('anropar analyzeSewageProperty med rätt parametrar', async () => {
      await request(app).post('/api/sewage/analyze').set('Authorization', authHeader()).send({
        propertyDesignation: 'GÄVLE BRYNÄS 1:1',
        municipalityCode: '2180',
        latitude: 60.67,
        longitude: 17.14,
        pe: 5,
      });

      expect(mocks.analyzeSewageProperty).toHaveBeenCalledWith(
        expect.objectContaining({
          propertyDesignation: 'GÄVLE BRYNÄS 1:1',
          municipalityCode: '2180',
          pe: 5,
        }),
      );
    });

    it('returnerar 400 om required fields saknas', async () => {
      const res = await request(app)
        .post('/api/sewage/analyze')
        .set('Authorization', authHeader())
        .send({ propertyDesignation: 'GÄVLE BRYNÄS 1:1' }); // Missing other fields

      expect(res.status).toBe(400);
      expect(res.body.ok).toBe(false);
    });

    it('returnerar 400 om PE är utanför giltigt intervall', async () => {
      const res = await request(app).post('/api/sewage/analyze').set('Authorization', authHeader()).send({
        propertyDesignation: 'GÄVLE BRYNÄS 1:1',
        municipalityCode: '2180',
        latitude: 60.67,
        longitude: 17.14,
        pe: 0, // Invalid: must be 1-200
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('PE');
    });

    it('returnerar 400 om PE överstiger max (200)', async () => {
      const res = await request(app).post('/api/sewage/analyze').set('Authorization', authHeader()).send({
        propertyDesignation: 'GÄVLE BRYNÄS 1:1',
        municipalityCode: '2180',
        latitude: 60.67,
        longitude: 17.14,
        pe: 201, // Invalid: exceeds 200
      });

      expect(res.status).toBe(400);
    });

    it('returnerar 400 om PE är ett decimaltal', async () => {
      const res = await request(app).post('/api/sewage/analyze').set('Authorization', authHeader()).send({
        propertyDesignation: 'GÄVLE BRYNÄS 1:1',
        municipalityCode: '2180',
        latitude: 60.67,
        longitude: 17.14,
        pe: 2.5, // Invalid: must be integer
      });

      expect(res.status).toBe(400);
    });

    it('returnerar 400 vid service-fel', async () => {
      mocks.analyzeSewageProperty.mockRejectedValue(new Error('SGU API error'));

      const res = await request(app).post('/api/sewage/analyze').set('Authorization', authHeader()).send({
        propertyDesignation: 'GÄVLE BRYNÄS 1:1',
        municipalityCode: '2180',
        latitude: 60.67,
        longitude: 17.14,
        pe: 5,
      });

      expect(res.status).toBe(400);
    });

    it('returnerar 401 utan autentisering', async () => {
      const res = await request(app).post('/api/sewage/analyze').send({
        propertyDesignation: 'GÄVLE BRYNÄS 1:1',
        municipalityCode: '2180',
        latitude: 60.67,
        longitude: 17.14,
        pe: 5,
      });

      expect(res.status).toBe(401);
    });
  });
});
