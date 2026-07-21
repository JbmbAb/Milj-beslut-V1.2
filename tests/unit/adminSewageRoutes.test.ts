import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTokenPair } from '../../server/security/auth';

const mocks = vi.hoisted(() => ({
  countAllProjects: vi.fn(),
  listProjectsSewagePage: vi.fn(),
  getProjectBasicForSewage: vi.fn(),
}));

vi.mock('../../server/repositories/tokenRepository', () => ({
  isTokenRevoked: vi.fn(async () => false),
  markRefreshTokenAsUsed: vi.fn(async () => undefined),
  revokeRefreshToken: vi.fn(async () => undefined),
  cleanupExpiredTokenRevocations: vi.fn(async () => 0),
}));

vi.mock('../../server/repositories/sewageApplicationRepository', () => ({
  listSewageApplicationsByOrg: vi.fn(async () => []),
}));

vi.mock('../../server/modules/platform/public', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../server/modules/platform/public')>();
  return {
    ...mod,
    countAllProjects: mocks.countAllProjects,
    listProjectsSewagePage: mocks.listProjectsSewagePage,
    getProjectBasicForSewage: mocks.getProjectBasicForSewage,
  };
});

import adminSewageRoutes from '../../server/routes/admin.v1.routes';

const app = express();
app.use(express.json());
app.use(adminSewageRoutes);

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
  status: 'ACTIVE',
  createdAt: new Date('2025-01-01'),
  environmentalScore: 70,
};

describe('admin.sewage routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.countAllProjects.mockResolvedValue(5);
    mocks.listProjectsSewagePage.mockResolvedValue([mockProject]);
    mocks.getProjectBasicForSewage.mockResolvedValue(mockProject);
  });

  describe('GET /api/sewage-applications', () => {
    it('returnerar paginerad lista av VA-ansökningar', async () => {
      const res = await request(app)
        .get('/api/sewage-applications?page=1&limit=10')
        .set('Authorization', authHeader());

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(Array.isArray(res.body.applications)).toBe(true);
      expect(res.body.total).toBe(5);
      expect(res.body.page).toBe(1);
    });

    it('mappar ACTIVE till UNDER_REVIEW', async () => {
      const res = await request(app).get('/api/sewage-applications').set('Authorization', authHeader());

      expect(res.status).toBe(200);
      expect(res.body.applications[0].status).toBe('UNDER_REVIEW');
    });

    it('mappar CLOSED till APPROVED', async () => {
      mocks.listProjectsSewagePage.mockResolvedValue([{ ...mockProject, status: 'CLOSED' }]);

      const res = await request(app).get('/api/sewage-applications').set('Authorization', authHeader());

      expect(res.status).toBe(200);
      expect(res.body.applications[0].status).toBe('APPROVED');
    });

    it('mappar andra statusar till DRAFT', async () => {
      mocks.listProjectsSewagePage.mockResolvedValue([{ ...mockProject, status: 'PENDING' }]);

      const res = await request(app).get('/api/sewage-applications').set('Authorization', authHeader());

      expect(res.status).toBe(200);
      expect(res.body.applications[0].status).toBe('DRAFT');
    });

    it('returnerar 401 utan autentisering', async () => {
      const res = await request(app).get('/api/sewage-applications');
      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/sewage-applications', () => {
    it('returnerar 410 Gone — canonical API är /api/sewage/applications', async () => {
      const res = await request(app)
        .post('/api/sewage-applications')
        .set('Authorization', authHeader())
        .send({
          propertyAddress: 'Industrivägen 1, Gävle',
          householdSize: 4,
          latitude: 60.67,
          longitude: 17.14,
        });

      expect(res.status).toBe(410);
      expect(res.body.canonical).toBe('/api/sewage/applications');
    });

    it('returnerar 401 utan autentisering', async () => {
      const res = await request(app)
        .post('/api/sewage-applications')
        .send({ propertyAddress: 'Test', householdSize: 4, latitude: 60, longitude: 17 });

      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/sewage-applications/:id', () => {
    it('returnerar en specifik VA-ansökan', async () => {
      const res = await request(app)
        .get('/api/sewage-applications/proj-1')
        .set('Authorization', authHeader());

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.application.id).toBe('proj-1');
    });

    it('returnerar 404 om ansökan inte hittas', async () => {
      mocks.getProjectBasicForSewage.mockResolvedValue(null);

      const res = await request(app)
        .get('/api/sewage-applications/nonexistent')
        .set('Authorization', authHeader());

      expect(res.status).toBe(404);
    });

    it('returnerar APPROVED status för stängda projekt', async () => {
      mocks.getProjectBasicForSewage.mockResolvedValue({ ...mockProject, status: 'CLOSED' });

      const res = await request(app)
        .get('/api/sewage-applications/proj-1')
        .set('Authorization', authHeader());

      expect(res.status).toBe(200);
      expect(res.body.application.status).toBe('APPROVED');
    });

    it('returnerar 401 utan autentisering', async () => {
      const res = await request(app).get('/api/sewage-applications/proj-1');
      expect(res.status).toBe(401);
    });
  });
});
