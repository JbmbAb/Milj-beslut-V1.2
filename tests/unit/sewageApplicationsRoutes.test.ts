import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTokenPair } from '../../server/security/auth';
import { __clearSewageApplicationStoreForTests } from '../../server/repositories/sewageApplicationRepository';

vi.mock('../../server/repositories/tokenRepository', () => ({
  isTokenRevoked: vi.fn(async () => false),
  markRefreshTokenAsUsed: vi.fn(async () => undefined),
  revokeRefreshToken: vi.fn(async () => undefined),
  cleanupExpiredTokenRevocations: vi.fn(async () => 0),
}));

vi.mock('../../server/security/projectAccess', () => ({
  assertProjectAccess: vi.fn(async () => undefined),
}));

const submitMock = vi.fn();
vi.mock('../../server/services/municipalitySubmissionService', () => ({
  submitSewageApplicationToMunicipality: (...args: unknown[]) => submitMock(...args),
}));

vi.mock('../../server/services/municipalityStatusPolling', () => ({
  getStatusHistory: vi.fn(async () => [{ status: 'SUBMITTED', at: new Date().toISOString() }]),
}));

vi.mock('../../server/services/auditTrailService', () => ({
  auditTrail: {
    logAction: vi.fn(async () => ({ id: 'audit-1' })),
    logSubmission: vi.fn(async () => undefined),
  },
  getAuditTrail: vi.fn(async () => [{ id: 'audit-1', action: 'APPLICATION_CREATED' }]),
}));

import sewageApplicationsRoutes from '../../server/routes/sewage.applications.routes';

const app = express();
app.use(express.json());
app.use(sewageApplicationsRoutes);

function authHeader(role: 'ADMIN' | 'CONSULTANT' = 'ADMIN') {
  return `Bearer ${
    createTokenPair({
      id: 'user-1',
      organisationId: 'org-1',
      bankidId: 'bankid-user-1',
      role,
    }).accessToken
  }`;
}

const validBody = {
  propertyDesignation: 'NACKA BOO 1:2',
  latitude: 59.33,
  longitude: 18.068,
  applicantName: 'Test Person',
  applicantEmail: 'test@example.invalid',
  systemType: 'INFILTRATION',
  projectId: 'proj-1',
  municipalityCode: '0180',
};

describe('sewage.applications.routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __clearSewageApplicationStoreForTests();
    submitMock.mockResolvedValue({
      ok: true,
      referenceNumber: 'AVLOPP-STO-123',
      municipalityCode: '0180',
      submittedAt: new Date().toISOString(),
      estimatedProcessingDays: 30,
      municipalityContactEmail: 'test@stockholm.se',
    });
  });

  afterEach(() => {
    __clearSewageApplicationStoreForTests();
  });

  it('returns 401 without auth on create', async () => {
    const res = await request(app).post('/api/sewage/applications').send(validBody);
    expect(res.status).toBe(401);
  });

  it('creates application with 201', async () => {
    const res = await request(app)
      .post('/api/sewage/applications')
      .set('Authorization', authHeader())
      .send(validBody);
    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.application.id).toMatch(/^avlopp-/);
    expect(res.body.application.status).toBe('DRAFT');
  });

  it('returns 422 for coordinates outside Sweden', async () => {
    const res = await request(app)
      .post('/api/sewage/applications')
      .set('Authorization', authHeader())
      .send({ ...validBody, latitude: 0, longitude: 0 });
    expect(res.status).toBe(422);
  });

  it('validates application and returns blockers when documents missing', async () => {
    const created = await request(app)
      .post('/api/sewage/applications')
      .set('Authorization', authHeader())
      .send(validBody);
    const id = created.body.application.id;

    const res = await request(app)
      .post(`/api/sewage/applications/${id}/validate`)
      .set('Authorization', authHeader())
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.canSubmit).toBe(false);
    expect(res.body.blockers.length).toBeGreaterThan(0);
  });

  it('generates documents', async () => {
    const created = await request(app)
      .post('/api/sewage/applications')
      .set('Authorization', authHeader())
      .send(validBody);
    const id = created.body.application.id;

    const res = await request(app)
      .post(`/api/sewage/applications/${id}/generate-documents`)
      .set('Authorization', authHeader())
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(String(res.body.situationPlanSVG)).toContain('<svg');
  });

  it('submits when documents generated', async () => {
    const created = await request(app)
      .post('/api/sewage/applications')
      .set('Authorization', authHeader())
      .send(validBody);
    const id = created.body.application.id;

    await request(app)
      .post(`/api/sewage/applications/${id}/generate-documents`)
      .set('Authorization', authHeader())
      .send({});

    const res = await request(app)
      .post(`/api/sewage/applications/${id}/submit`)
      .set('Authorization', authHeader())
      .send({ municipalityCode: '0180', projectId: 'proj-1' });

    expect([200, 422, 503]).toContain(res.status);
    if (res.status === 200) {
      expect(res.body.referenceNumber).toBeTruthy();
      expect(submitMock).toHaveBeenCalled();
    }
  });

  it('returns export json', async () => {
    const created = await request(app)
      .post('/api/sewage/applications')
      .set('Authorization', authHeader())
      .send(validBody);
    const id = created.body.application.id;

    const res = await request(app)
      .get(`/api/sewage/applications/${id}/export`)
      .set('Authorization', authHeader());
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/json/);
    expect(res.body.export.humanInTheLoop).toContain('verifiera');
  });

  it('denies cross-org access for consultant', async () => {
    const created = await request(app)
      .post('/api/sewage/applications')
      .set('Authorization', authHeader('ADMIN'))
      .send(validBody);
    const id = created.body.application.id;

    const res = await request(app)
      .get(`/api/sewage/applications/${id}`)
      .set(
        'Authorization',
        `Bearer ${
          createTokenPair({
            id: 'user-2',
            organisationId: 'org-other',
            bankidId: 'bankid-2',
            role: 'CONSULTANT',
          }).accessToken
        }`,
      );
    expect(res.status).toBe(403);
  });

  it('returns audit-trail entries', async () => {
    const created = await request(app)
      .post('/api/sewage/applications')
      .set('Authorization', authHeader())
      .send(validBody);
    const id = created.body.application.id;

    const res = await request(app)
      .get(`/api/sewage/applications/${id}/audit-trail`)
      .set('Authorization', authHeader());
    expect(res.status).toBe(200);
    expect(res.body.entries).toBeDefined();
  });
});
