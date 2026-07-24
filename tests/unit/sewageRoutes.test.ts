import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTokenPair } from '../../server/security/auth';

const mocks = vi.hoisted(() => ({
  generateSewageApplicationDocuments: vi.fn(),
  submitSewageApplicationToMunicipality: vi.fn(),
  handleMunicipalityWebhook: vi.fn(),
  getStatusHistory: vi.fn(),
  appealDecision: vi.fn(),
  generateComplianceReport: vi.fn(),
  getAuditTrail: vi.fn(),
  initiateBankIDSignature: vi.fn(),
  completeBankIDSignature: vi.fn(),
  checkSignatureStatus: vi.fn(),
  verifyAllSignaturesForApplication: vi.fn(),
  getSubmissionOrgAndProjectByKey: vi.fn(),
  assertProjectAccess: vi.fn(),
  getEnv: vi.fn(),
  // Repository mocks
  getSewageApplicationById: vi.fn(),
  createSewageApplicationRecord: vi.fn(),
  updateSewageApplicationRecord: vi.fn(),
  listSewageApplicationsByOrg: vi.fn(),
  // Service mocks
  createSewageApplication: vi.fn(),
  validateApplicationForSubmission: vi.fn(),
  submitApplicationToMunicipality: vi.fn(),
}));

vi.mock('../../server/repositories/sewageApplicationRepository', () => ({
  getSewageApplicationById: mocks.getSewageApplicationById,
  createSewageApplicationRecord: mocks.createSewageApplicationRecord,
  updateSewageApplicationRecord: mocks.updateSewageApplicationRecord,
  listSewageApplicationsByOrg: mocks.listSewageApplicationsByOrg,
}));

vi.mock('../../server/services/sewageApplicationService', () => ({
  createSewageApplication: mocks.createSewageApplication,
  validateApplicationForSubmission: mocks.validateApplicationForSubmission,
  submitApplicationToMunicipality: mocks.submitApplicationToMunicipality,
}));

vi.mock('../../server/repositories/tokenRepository', () => ({
  isTokenRevoked: vi.fn(async () => false),
  markRefreshTokenAsUsed: vi.fn(async () => undefined),
  revokeRefreshToken: vi.fn(async () => undefined),
  cleanupExpiredTokenRevocations: vi.fn(async () => 0),
}));

vi.mock('../../server/modules/sewage/public', () => ({
  generateSewageApplicationDocuments: mocks.generateSewageApplicationDocuments,
  submitSewageApplicationToMunicipality: mocks.submitSewageApplicationToMunicipality,
  handleMunicipalityWebhook: mocks.handleMunicipalityWebhook,
  getStatusHistory: mocks.getStatusHistory,
  appealDecision: mocks.appealDecision,
  generateComplianceReport: mocks.generateComplianceReport,
  getAuditTrail: mocks.getAuditTrail,
  initiateBankIDSignature: mocks.initiateBankIDSignature,
  completeBankIDSignature: mocks.completeBankIDSignature,
  checkSignatureStatus: mocks.checkSignatureStatus,
  verifyAllSignaturesForApplication: mocks.verifyAllSignaturesForApplication,
  getSubmissionOrgAndProjectByKey: mocks.getSubmissionOrgAndProjectByKey,
  createSewageApplication: mocks.createSewageApplication,
  validateApplicationForSubmission: mocks.validateApplicationForSubmission,
  submitApplicationToMunicipality: mocks.submitApplicationToMunicipality,
  generateSewageDossierPdf: vi.fn(),
  getSewageApplicationById: mocks.getSewageApplicationById,
  updateSewageApplicationRecord: mocks.updateSewageApplicationRecord,
  listSewageApplicationsByOrg: mocks.listSewageApplicationsByOrg,
}));

vi.mock('../../server/security/projectAccess', () => ({
  assertProjectAccess: mocks.assertProjectAccess,
}));

vi.mock('../../server/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../server/security/env', () => ({
  getEnv: mocks.getEnv,
}));

import sewageRoutes from '../../server/routes/sewage.routes';

const app = express();
app.use(express.json());
app.use(sewageRoutes);

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

const mockRecord = {
  id: 'app-1',
  referenceNumber: 'AVLOPP-app-1',
  organisationId: 'org-1',
  projectId: 'proj-1',
  municipalityCode: '2180',
  status: 'DRAFT',
  domainSnapshot: {
    protectionProfile: { timelineEstimateWeeks: 8 },
  },
};

describe('sewage.routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertProjectAccess.mockResolvedValue(undefined);
    mocks.getSubmissionOrgAndProjectByKey.mockResolvedValue({ projectId: 'proj-1', organisationId: 'org-1' });
    mocks.getSewageApplicationById.mockResolvedValue(mockRecord);
    mocks.validateApplicationForSubmission.mockResolvedValue({ canSubmit: true, blockers: [], warnings: [] });
    mocks.submitApplicationToMunicipality.mockResolvedValue({
      success: true,
      referenceNumber: 'REF-2025-001',
      estimatedProcessingTime: 8,
    });
    mocks.handleMunicipalityWebhook.mockResolvedValue({ ok: true });
    mocks.getStatusHistory.mockResolvedValue([]);
    mocks.appealDecision.mockResolvedValue({ appealId: 'appeal-1' });
    mocks.getAuditTrail.mockResolvedValue([]);
    mocks.generateComplianceReport.mockResolvedValue({});
    mocks.initiateBankIDSignature.mockResolvedValue({ orderRef: 'order-1' });
    mocks.completeBankIDSignature.mockResolvedValue({ signatureId: 'sig-1' });
    mocks.checkSignatureStatus.mockResolvedValue({ status: 'PENDING' });
    mocks.verifyAllSignaturesForApplication.mockResolvedValue({ allSigned: true });
    mocks.getEnv.mockReturnValue('webhook-secret');
  });

  describe('LIFECYCLE', () => {
    it('POST /sewage/application - skapar utkast', async () => {
      mocks.createSewageApplication.mockResolvedValue(mockRecord);
      const res = await request(app)
        .post('/sewage/application')
        .set('Authorization', authHeader())
        .send({ projectId: 'proj-1', propertyDesignation: 'X' });

      expect(res.status).toBe(201);
      expect(res.body.id).toBe('app-1');
    });

    it('GET /sewage/applications - listar ansökningar', async () => {
      mocks.listSewageApplicationsByOrg.mockResolvedValue([mockRecord]);
      const res = await request(app).get('/sewage/applications').set('Authorization', authHeader());

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
    });

    it('GET /sewage/application/:id - hämtar en ansökan', async () => {
      const res = await request(app).get('/sewage/application/app-1').set('Authorization', authHeader());

      expect(res.status).toBe(200);
      expect(res.body.id).toBe('app-1');
    });

    it('PATCH /sewage/application/:id - uppdaterar utkast', async () => {
      mocks.updateSewageApplicationRecord.mockResolvedValue({ ...mockRecord, pe: 6 });
      const res = await request(app)
        .patch('/sewage/application/app-1')
        .set('Authorization', authHeader())
        .send({ pe: 6 });

      expect(res.status).toBe(200);
      expect(res.body.pe).toBe(6);
    });
  });

  describe('VALIDATION & SUBMISSION', () => {
    it('GET /sewage/application/:id/validate - validerar ansökan', async () => {
      const res = await request(app)
        .get('/sewage/application/app-1/validate')
        .set('Authorization', authHeader());

      expect(res.status).toBe(200);
      expect(res.body.canSubmit).toBe(true);
    });

    it('POST /sewage/application/:id/submit - skickar in ansökan', async () => {
      const res = await request(app)
        .post('/sewage/application/app-1/submit')
        .set('Authorization', authHeader());

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.referenceNumber).toBe('REF-2025-001');
    });

    it('POST /sewage/application/:id/submit - returnerar 400 om validering misslyckas', async () => {
      mocks.validateApplicationForSubmission.mockResolvedValue({ canSubmit: false, blockers: ['Blocker'] });
      const res = await request(app)
        .post('/sewage/application/app-1/submit')
        .set('Authorization', authHeader());

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('not valid');
    });
  });

  describe('WEBHOOKS & STATUS', () => {
    it('GET /sewage/application/:ref/status - returnerar lokal stub när extern status saknas', async () => {
      const res = await request(app)
        .get('/sewage/application/REF-1/status')
        .set('Authorization', authHeader());

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });

    it('POST /sewage/webhooks/municipality-status - hanterar webhook', async () => {
      const res = await request(app)
        .post('/sewage/webhooks/municipality-status')
        .send({ referenceNumber: 'REF-1', status: 'APPROVED' });

      expect(res.status).toBe(200);
    });
  });
});
