import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTokenPair } from '../../server/security/auth';

const mocks = vi.hoisted(() => ({
  createSewageApplication: vi.fn(),
  validateApplicationForSubmission: vi.fn(),
  submitApplicationToMunicipality: vi.fn(),
  generateSewageDocuments: vi.fn(),
  generateSewageRequirementChecklist: vi.fn(),
  validateSewageApplicationRegulations: vi.fn(),
}));

vi.mock('../../server/repositories/tokenRepository', () => ({
  isTokenRevoked: vi.fn(async () => false),
  markRefreshTokenAsUsed: vi.fn(async () => undefined),
  revokeRefreshToken: vi.fn(async () => undefined),
  cleanupExpiredTokenRevocations: vi.fn(async () => 0),
}));

vi.mock('../../server/services/sewageApplicationService', () => ({
  createSewageApplication: mocks.createSewageApplication,
  validateApplicationForSubmission: mocks.validateApplicationForSubmission,
  submitApplicationToMunicipality: mocks.submitApplicationToMunicipality,
  generateSubmissionSummary: vi.fn(),
  updateGateStatus: vi.fn(),
}));

vi.mock('../../server/services/sewageDocumentGeneratorService', () => ({
  generateSewageDocuments: mocks.generateSewageDocuments,
}));

vi.mock('../../server/services/sewageRegulationsService', () => ({
  generateSewageRequirementChecklist: mocks.generateSewageRequirementChecklist,
  validateSewageApplicationRegulations: mocks.validateSewageApplicationRegulations,
}));

import adminSewageApplicationRoutes from '../../server/routes/admin.v1.routes';

const app = express();
app.use(express.json());
app.use(adminSewageApplicationRoutes);

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

const mockApplication = {
  id: 'app-1',
  projectId: 'proj-1',
  propertyDesignation: 'GÄVLE BRYNÄS 1:1',
  municipalityCode: '2180',
  pe: 5,
  status: 'DRAFT',
  systemType: 'INFILTRATION',
  createdAt: new Date().toISOString(),
};

/*
describe('admin.sewage-application routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createSewageApplication.mockResolvedValue(mockApplication);
    mocks.generateSewageRequirementChecklist.mockReturnValue([
      { id: 'req-1', description: 'Perkolationsprov krävs', status: 'PENDING' },
    ]);
    mocks.validateSewageApplicationRegulations.mockReturnValue({
      isCompliant: true,
      violations: [],
      warnings: [],
      recommendations: ['Kontakta Naturvårdsverket'],
    });
    mocks.validateApplicationForSubmission.mockReturnValue({
      canSubmit: true,
      blockers: [],
      warnings: [],
    });
    mocks.submitApplicationToMunicipality.mockResolvedValue({
      success: true,
      submissionId: 'sub-1',
      referenceNumber: 'REF-2026-001',
      estimatedProcessingTime: '3-6 månader',
    });
    mocks.generateSewageDocuments.mockResolvedValue({
      situationPlanSVG: '<svg>...</svg>',
      crossSectionSVG: '<svg>...</svg>',
      generatedAt: new Date().toISOString(),
    });
  });

  describe('POST /api/sewage/application/create', () => {
    it('skapar ny VA-ansökan', async () => {
      const res = await request(app)
        .post('/api/sewage/application/create')
        .set('Authorization', authHeader())
        .send({
          projectId: 'proj-1',
          propertyDesignation: 'GÄVLE BRYNÄS 1:1',
          municipalityCode: '2180',
          pe: 5,
        });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.application.id).toBe('app-1');
    });

    it('returnerar 400 om required fields saknas', async () => {
      const res = await request(app)
        .post('/api/sewage/application/create')
        .set('Authorization', authHeader())
        .send({ projectId: 'proj-1' }); // Missing municipalityCode and pe

      expect(res.status).toBe(400);
      expect(res.body.ok).toBe(false);
    });

    it('returnerar 401 utan auth', async () => {
      const res = await request(app)
        .post('/api/sewage/application/create')
        .send({ projectId: 'proj-1', propertyDesignation: 'X', municipalityCode: '2180', pe: 5 });

      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/sewage/application/:id/requirements', () => {
    it('genererar kravlista för VA-system', async () => {
      const res = await request(app)
        .post('/api/sewage/application/app-1/requirements')
        .set('Authorization', authHeader())
        .send({ systemType: 'INFILTRATION', protectionLevel: 'NORMAL', municipalityCode: '2180' });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.count).toBe(1);
    });

    it('returnerar 400 om fields saknas', async () => {
      const res = await request(app)
        .post('/api/sewage/application/app-1/requirements')
        .set('Authorization', authHeader())
        .send({ systemType: 'INFILTRATION' }); // Missing protectionLevel + municipalityCode

      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/sewage/application/:id/validate', () => {
    it('validerar ansökan mot regelverk', async () => {
      const res = await request(app)
        .post('/api/sewage/application/app-1/validate')
        .set('Authorization', authHeader())
        .send({
          application: mockApplication,
          protectionProfile: { protectionLevel: 'NORMAL' },
        });

      expect(res.status).toBe(200);
      expect(res.body.canSubmit).toBe(true);
      expect(res.body.regulatoryCompliance).toBe(true);
    });

    it('returnerar 400 om application saknas', async () => {
      const res = await request(app)
        .post('/api/sewage/application/app-1/validate')
        .set('Authorization', authHeader())
        .send({});

      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/sewage/application/:id/generate-documents', () => {
    it('genererar VA-dokument', async () => {
      const res = await request(app)
        .post('/api/sewage/application/app-1/generate-documents')
        .set('Authorization', authHeader())
        .send({
          application: mockApplication,
          gisAnalysis: { overallRiskScore: 30 },
          protectionProfile: { protectionLevel: 'NORMAL' },
        });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.documents).toBeDefined();
    });

    it('returnerar 400 om data saknas', async () => {
      const res = await request(app)
        .post('/api/sewage/application/app-1/generate-documents')
        .set('Authorization', authHeader())
        .send({ application: mockApplication }); // Missing gisAnalysis and protectionProfile

      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/sewage/application/:id/update-soil-test', () => {
    it('registrerar markprovresultat', async () => {
      const res = await request(app)
        .post('/api/sewage/application/app-1/update-soil-test')
        .set('Authorization', authHeader())
        .send({ ltar: 10, testDate: '2026-01-15' });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.data.ltar).toBe(10);
    });

    it('returnerar 400 om ltar eller testDate saknas', async () => {
      const res = await request(app)
        .post('/api/sewage/application/app-1/update-soil-test')
        .set('Authorization', authHeader())
        .send({ ltar: 10 }); // Missing testDate

      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/sewage/application/:id/record-neighbor-consent', () => {
    it('registrerar grannemedgivande', async () => {
      const res = await request(app)
        .post('/api/sewage/application/app-1/record-neighbor-consent')
        .set('Authorization', authHeader())
        .send({ neighborName: 'Anna Svensson', distance: 10 });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.data.neighborName).toBe('Anna Svensson');
    });

    it('returnerar 400 om neighborName saknas', async () => {
      const res = await request(app)
        .post('/api/sewage/application/app-1/record-neighbor-consent')
        .set('Authorization', authHeader())
        .send({ distance: 10 });

      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/sewage/application/:id/submit', () => {
    it('skickar ansökan till kommunen', async () => {
      const res = await request(app)
        .post('/api/sewage/application/app-1/submit')
        .set('Authorization', authHeader())
        .send({ application: mockApplication, municipalityCode: '2180' });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.referenceNumber).toBe('REF-2026-001');
    });

    it('returnerar 400 om application inte är DRAFT', async () => {
      const res = await request(app)
        .post('/api/sewage/application/app-1/submit')
        .set('Authorization', authHeader())
        .send({
          application: { ...mockApplication, status: 'SUBMITTED' },
          municipalityCode: '2180',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('DRAFT');
    });

    it('returnerar 400 om submission misslyckas', async () => {
      mocks.submitApplicationToMunicipality.mockResolvedValue({
        success: false,
        error: 'Kommunens portal är nere',
      });

      const res = await request(app)
        .post('/api/sewage/application/app-1/submit')
        .set('Authorization', authHeader())
        .send({ application: mockApplication, municipalityCode: '2180' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Kommunens portal är nere');
    });
  });

  describe('GET /api/sewage/application/:id', () => {
    it('hämtar ansökan via ID', async () => {
      const res = await request(app).get('/api/sewage/application/app-1').set('Authorization', authHeader());

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.application.id).toBe('app-1');
    });
  });
});
*/
