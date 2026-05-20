import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTokenPair } from '../../server/security/auth';
import type { UserRole } from '../../server/security/types';

const mocks = vi.hoisted(() => ({
  getProjectForPlanHeader: vi.fn(),
}));

vi.mock('../../server/repositories/tokenRepository', () => ({
  isTokenRevoked: vi.fn(async () => false),
  markRefreshTokenAsUsed: vi.fn(async () => undefined),
  revokeRefreshToken: vi.fn(async () => undefined),
  cleanupExpiredTokenRevocations: vi.fn(async () => 0),
}));

vi.mock('../../server/modules/platform/public', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../server/modules/platform/public')>();
  return {
    ...mod,
    getProjectForPlanHeader: mocks.getProjectForPlanHeader,
  };
});

import adminProjectPlanRoutes from '../../server/routes/admin.v1.routes';

const app = express();
app.use(express.json());
app.use(adminProjectPlanRoutes);

function authHeader(role: UserRole = 'CONSULTANT') {
  return `Bearer ${
    createTokenPair({
      id: 'user-1',
      organisationId: 'org-1',
      bankidId: 'user:one',
      role,
    }).accessToken
  }`;
}

const mockProject = {
  id: 'proj-1',
  propertyDesignation: 'GÄVLE BRYNÄS 1:1',
  status: 'ACTIVE',
  createdAt: new Date(),
};

/*
describe('admin.project-plan routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getProjectForPlanHeader.mockResolvedValue(mockProject);
  });

  describe('GET /api/projects/:projectId/plan', () => {
    it('hämtar projektplan med faser och risker', async () => {
      const res = await request(app).get('/api/projects/proj-1/plan').set('Authorization', authHeader());

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.plan.projectId).toBe('proj-1');
      // Tom defaultplan tills en verifierad plan finns sparad
      expect(res.body.plan.plan.phases).toHaveLength(0);
    });

    it('returnerar 404 om projektet inte hittas', async () => {
      mocks.getProjectForPlanHeader.mockResolvedValue(null);

      const res = await request(app).get('/api/projects/nonexistent/plan').set('Authorization', authHeader());

      expect(res.status).toBe(404);
      expect(res.body.error).toContain('not found');
    });

    it('innehåller stakeholders och risker', async () => {
      const res = await request(app).get('/api/projects/proj-1/plan').set('Authorization', authHeader());

      expect(res.body.plan.plan.stakeholders).toHaveLength(0);
      expect(res.body.plan.plan.risks).toHaveLength(0);
    });

    it('returnerar 401 utan autentisering', async () => {
      const res = await request(app).get('/api/projects/proj-1/plan');

      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/projects/:projectId/plan', () => {
    it('sparar projektplan med faser', async () => {
      const res = await request(app)
        .post('/api/projects/proj-1/plan')
        .set('Authorization', authHeader())
        .send({
          plan: {
            phases: [{ id: 'phase-1', name: 'Planering', status: 'TODO' }],
            risks: [{ id: 'risk-1', name: 'Väder', impact: 'MEDIUM' }],
            stakeholders: [],
          },
        });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.plan.plan.phases).toHaveLength(1);
    });

    it('returnerar 400 om plan saknas', async () => {
      const res = await request(app)
        .post('/api/projects/proj-1/plan')
        .set('Authorization', authHeader())
        .send({});

      expect(res.status).toBe(400);
    });

    it('returnerar 400 om phases inte är en array', async () => {
      const res = await request(app)
        .post('/api/projects/proj-1/plan')
        .set('Authorization', authHeader())
        .send({ plan: { phases: 'not-an-array' } });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('phases');
    });

    it('inkluderar metadata med userId och tidpunkt', async () => {
      const res = await request(app)
        .post('/api/projects/proj-1/plan')
        .set('Authorization', authHeader())
        .send({
          plan: { phases: [], risks: [], stakeholders: [] },
          generatedAt: '2026-01-01T00:00:00Z',
        });

      expect(res.status).toBe(200);
      expect(res.body.plan.metadata.editedBy).toBe('user-1');
      expect(res.body.plan.metadata.generatedAt).toBe('2026-01-01T00:00:00Z');
    });

    it('returnerar 401 utan autentisering', async () => {
      const res = await request(app)
        .post('/api/projects/proj-1/plan')
        .send({ plan: { phases: [] } });

      expect(res.status).toBe(401);
    });
  });
});
*/
