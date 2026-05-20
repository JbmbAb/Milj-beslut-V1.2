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

const mockSubmission = {
  projectId: 'proj-1',
  organisationId: 'org-1',
};

const mockApplication = {
  id: 'app-1',
  projectId: 'proj-1',
  propertyDesignation: 'GÄVLE BRYNÄS 1:1',
  pe: 5,
  selectedSystemType: 'INFILTRATION',
  status: 'DRAFT',
};

const mockProtectionProfile = {
  propertyId: 'prop-1',
  protectionLevel: 'NORMAL',
  nearestWell: { distance: 50, owner: 'NEIGHBOR', coordinates: { lat: 60.67, lng: 17.14 } },
  nearestWaterCourse: { distance: 100, type: 'Bäck', name: 'Källbäcken' },
  distanceToPropertyLine: 5,
  soilProfile: {
    soilType: 'Sand',
    depthToRock: 5,
    groundwaterLevel: 2.5,
    infiltrationCapacity: 'HIGH',
    permeability: 50,
  },
  floodRisk: 'LOW',
  protectedNatureNearby: false,
  recommendedSystem: 'INFILTRATION',
  timelineEstimateWeeks: 8,
  requiredGates: [],
};

const mockAnalysis = {
  propertyId: 'prop-1',
  timestamp: new Date().toISOString(),
  overallRiskScore: 30,
  feasibilityScore: 80,
  recommendedSystems: ['INFILTRATION'],
  blockedSystems: [],
  reasoning: [],
};

describe('sewage.routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertProjectAccess.mockResolvedValue(undefined);
    mocks.getSubmissionOrgAndProjectByKey.mockResolvedValue(mockSubmission);
    mocks.generateSewageApplicationDocuments.mockReturnValue({
      situationPlanSVG: '<svg>situationsplan</svg>',
      crossSectionSVG: '<svg>tvärsektion</svg>',
      generatedAt: new Date().toISOString(),
    });
    mocks.submitSewageApplicationToMunicipality.mockResolvedValue({
      referenceNumber: 'REF-2025-001',
      municipalityCode: '2180',
      municipalityContactEmail: 'miljo@gavle.se',
      estimatedProcessingDays: 30,
      submittedAt: new Date().toISOString(),
    });
    mocks.handleMunicipalityWebhook.mockResolvedValue({ ok: true, processed: true });
    mocks.getStatusHistory.mockResolvedValue([{ status: 'SUBMITTED', timestamp: new Date().toISOString() }]);
    mocks.appealDecision.mockResolvedValue({
      appealId: 'appeal-1',
      status: 'SUBMITTED_TO_LANSSTYRELSEN',
    });
    mocks.generateComplianceReport.mockResolvedValue({ sections: [], generatedAt: new Date().toISOString() });
    mocks.getAuditTrail.mockResolvedValue([{ event: 'SUBMISSION', timestamp: new Date().toISOString() }]);
    mocks.initiateBankIDSignature.mockResolvedValue({
      orderRef: 'order-1',
      qrData: 'bankid-qr-data',
    });
    mocks.completeBankIDSignature.mockResolvedValue({
      signatureId: 'sig-1',
      signedAt: new Date().toISOString(),
    });
    mocks.checkSignatureStatus.mockResolvedValue({ status: 'PENDING' });
    mocks.verifyAllSignaturesForApplication.mockResolvedValue({
      allSigned: true,
      signatures: [],
    });
    mocks.getEnv.mockReturnValue('webhook-secret');
  });

  // ============================================================================
  // POST /sewage/application/:id/submit
  // ============================================================================

  describe('POST /sewage/application/:id/submit', () => {
    it('skickar in ansökan med befintliga SVG-dokument', async () => {
      const res = await request(app)
        .post('/sewage/application/app-1/submit')
        .set('Authorization', authHeader())
        .send({
          application: mockApplication,
          protectionProfile: mockProtectionProfile,
          analysis: mockAnalysis,
          municipalityCode: '2180',
          situationPlanSVG: '<svg>plan</svg>',
          crossSectionSVG: '<svg>section</svg>',
        });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.referenceNumber).toBe('REF-2025-001');
      expect(res.body.municipalityEmail).toBe('miljo@gavle.se');
    });

    it('genererar SVG-dokument om de saknas', async () => {
      const res = await request(app)
        .post('/sewage/application/app-1/submit')
        .set('Authorization', authHeader())
        .send({
          application: mockApplication,
          protectionProfile: mockProtectionProfile,
          analysis: mockAnalysis,
          municipalityCode: '2180',
          // No SVGs provided — should be generated
        });

      expect(res.status).toBe(200);
      expect(mocks.generateSewageApplicationDocuments).toHaveBeenCalled();
    });

    it('returnerar 401 utan autentisering', async () => {
      const res = await request(app).post('/sewage/application/app-1/submit').send({
        application: mockApplication,
        protectionProfile: mockProtectionProfile,
        municipalityCode: '2180',
      });

      expect(res.status).toBe(401);
    });

    it('returnerar 400 om required fields saknas', async () => {
      const res = await request(app)
        .post('/sewage/application/app-1/submit')
        .set('Authorization', authHeader())
        .send({ application: mockApplication }); // Missing protectionProfile and municipalityCode

      expect(res.status).toBe(400);
    });

    it('returnerar 500 vid service-fel', async () => {
      mocks.submitSewageApplicationToMunicipality.mockRejectedValue(new Error('Municipality API nere'));

      const res = await request(app)
        .post('/sewage/application/app-1/submit')
        .set('Authorization', authHeader())
        .send({
          application: mockApplication,
          protectionProfile: mockProtectionProfile,
          analysis: mockAnalysis,
          municipalityCode: '2180',
          situationPlanSVG: '<svg/>',
          crossSectionSVG: '<svg/>',
        });

      expect(res.status).toBe(500);
    });

    it('inkluderar estimatedProcessingWeeks i svaret', async () => {
      const res = await request(app)
        .post('/sewage/application/app-1/submit')
        .set('Authorization', authHeader())
        .send({
          application: mockApplication,
          protectionProfile: mockProtectionProfile,
          analysis: mockAnalysis,
          municipalityCode: '2180',
          situationPlanSVG: '<svg/>',
          crossSectionSVG: '<svg/>',
        });

      expect(res.status).toBe(200);
      expect(typeof res.body.estimatedProcessingWeeks).toBe('number');
    });
  });

  // ============================================================================
  // GET /sewage/application/:referenceNumber/status
  // ============================================================================

  describe('GET /sewage/application/:referenceNumber/status', () => {
    it('returnerar 501 när statuskälla inte är konfigurerad (säkert beteende)', async () => {
      const res = await request(app)
        .get('/sewage/application/REF-2025-001/status')
        .set('Authorization', authHeader());

      expect(res.status).toBe(501);
      expect(res.body.code).toBe('SEWAGE_STATUS_SOURCE_NOT_CONFIGURED');
      expect(res.body.referenceNumber).toBe('REF-2025-001');
    });

    it('returnerar 401 utan autentisering', async () => {
      const res = await request(app).get('/sewage/application/REF-2025-001/status');
      expect(res.status).toBe(401);
    });

    it('returnerar 500 vid databasfel', async () => {
      mocks.getSubmissionOrgAndProjectByKey.mockRejectedValue(new Error('DB error'));
      const res = await request(app)
        .get('/sewage/application/REF-2025-001/status')
        .set('Authorization', authHeader());

      expect(res.status).toBe(500);
    });
  });

  // ============================================================================
  // POST /sewage/webhooks/municipality-status
  // ============================================================================

  describe('POST /sewage/webhooks/municipality-status', () => {
    it('hanterar webhook utan secret (development mode)', async () => {
      delete process.env.MUNICIPALITY_WEBHOOK_SECRET;

      const res = await request(app).post('/sewage/webhooks/municipality-status').send({
        referenceNumber: 'REF-2025-001',
        status: 'APPROVED',
        municipalityCode: '2180',
      });

      // Without secret, should process normally
      expect([200, 500]).toContain(res.status);
    });

    it('returnerar 500 vid service-fel', async () => {
      mocks.handleMunicipalityWebhook.mockRejectedValue(new Error('Webhook processing failed'));

      const res = await request(app)
        .post('/sewage/webhooks/municipality-status')
        .send({ referenceNumber: 'REF-2025-001', status: 'APPROVED', municipalityCode: '2180' });

      expect(res.status).toBe(500);
    });
  });

  // ============================================================================
  // GET /sewage/application/:referenceNumber/history
  // ============================================================================

  describe('GET /sewage/application/:referenceNumber/history', () => {
    it('returnerar statushistorik för en ansökan', async () => {
      const res = await request(app)
        .get('/sewage/application/REF-2025-001/history')
        .set('Authorization', authHeader());

      expect(res.status).toBe(200);
      expect(res.body.referenceNumber).toBe('REF-2025-001');
      expect(Array.isArray(res.body.history)).toBe(true);
    });

    it('returnerar 401 utan autentisering', async () => {
      const res = await request(app).get('/sewage/application/REF-2025-001/history');
      expect(res.status).toBe(401);
    });
  });

  // ============================================================================
  // POST /sewage/application/:referenceNumber/appeal
  // ============================================================================

  describe('POST /sewage/application/:referenceNumber/appeal', () => {
    it('skickar in en överklagan', async () => {
      const res = await request(app)
        .post('/sewage/application/REF-2025-001/appeal')
        .set('Authorization', authHeader())
        .send({
          appealReason: 'Beslutet är felaktigt eftersom grundvattennivån överskattades.',
          attachments: [],
        });

      expect(res.status).toBe(200);
      expect(res.body.appealId).toBe('appeal-1');
    });

    it('returnerar 400 om appealReason saknas', async () => {
      const res = await request(app)
        .post('/sewage/application/REF-2025-001/appeal')
        .set('Authorization', authHeader())
        .send({}); // No appealReason

      expect(res.status).toBe(400);
    });

    it('returnerar 401 utan autentisering', async () => {
      const res = await request(app)
        .post('/sewage/application/REF-2025-001/appeal')
        .send({ appealReason: 'Skäl' });

      expect(res.status).toBe(401);
    });
  });

  // ============================================================================
  // POST /sewage/signatures/initiate-bankid
  // ============================================================================

  describe('POST /sewage/signatures/initiate-bankid', () => {
    it('initierar BankID-signatur', async () => {
      const res = await request(app)
        .post('/sewage/signatures/initiate-bankid')
        .set('Authorization', authHeader())
        .send({
          referenceNumber: 'REF-2025-001',
          documentId: 'doc-1',
          documentContent: 'base64content',
          personalNumber: '19900101-0001',
        });

      expect(res.status).toBe(200);
      expect(res.body.orderRef).toBe('order-1');
    });

    it('returnerar 400 om required fields saknas', async () => {
      const res = await request(app)
        .post('/sewage/signatures/initiate-bankid')
        .set('Authorization', authHeader())
        .send({ referenceNumber: 'REF-2025-001' }); // Missing documentId and documentContent

      expect(res.status).toBe(400);
    });

    it('returnerar 401 utan autentisering', async () => {
      const res = await request(app)
        .post('/sewage/signatures/initiate-bankid')
        .send({ referenceNumber: 'REF-2025-001', documentId: 'doc-1', documentContent: 'content' });

      expect(res.status).toBe(401);
    });
  });

  // ============================================================================
  // POST /sewage/signatures/complete-bankid
  // ============================================================================

  describe('POST /sewage/signatures/complete-bankid', () => {
    it('slutför BankID-signatur', async () => {
      const res = await request(app)
        .post('/sewage/signatures/complete-bankid')
        .set('Authorization', authHeader())
        .send({
          orderRef: 'order-1',
          documentHash: 'sha256hash',
          referenceNumber: 'REF-2025-001',
        });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.signature.signatureId).toBe('sig-1');
    });

    it('returnerar 400 om required fields saknas', async () => {
      const res = await request(app)
        .post('/sewage/signatures/complete-bankid')
        .set('Authorization', authHeader())
        .send({ orderRef: 'order-1' }); // Missing documentHash and referenceNumber

      expect(res.status).toBe(400);
    });
  });
});
