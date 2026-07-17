import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createTokenPair } from '../../server/security/auth';
import { createApp } from '../../server/createApp';
import type { DbContentsResponse } from '../../types';

vi.mock('../../server/repositories/userRepository', () => ({
  ensureAdminConsoleUser: vi.fn(async () => ({
    id: 'test-admin-id',
    bankidId: 'admin:admin',
    role: 'ADMIN',
    organisationId: 'test-org-id',
  })),
  findAuthUserByBankId: vi.fn(async () => null),
}));

vi.mock('../../server/repositories/tokenRepository', () => ({
  isTokenRevoked: vi.fn(async () => false),
  markRefreshTokenAsUsed: vi.fn(async () => undefined),
  revokeRefreshToken: vi.fn(async () => undefined),
  cleanupExpiredTokenRevocations: vi.fn(async () => 0),
}));

const mockContents: DbContentsResponse = {
  generatedAt: new Date().toISOString(),
  limit: 10,
  organisations: {
    total: 2,
    rows: [
      {
        id: 'org-1',
        name: 'Testorg AB',
        orgNumber: '556000-0001',
        createdAt: new Date().toISOString(),
        userCount: 3,
        projectCount: 1,
      },
    ],
  },
  projects: {
    total: 1,
    rows: [
      {
        id: 'proj-1',
        propertyDesignation: 'Kungsbacka 1:1',
        status: 'ACTIVE',
        organisationName: 'Testorg AB',
        createdAt: new Date().toISOString(),
        documentCount: 3,
        requirementCount: 15,
      },
    ],
  },
  documents: {
    total: 3,
    rows: [
      {
        id: 'doc-1',
        subject: 'Tillstånd Kungsbacka',
        status: 'COMPLETE',
        municipality: 'Kungsbacka',
        decisionType: 'Tillstånd',
        legalStatus: 'Lagakraftvunnen',
        fileSize: 102400,
        createdAt: new Date().toISOString(),
      },
    ],
  },
  requirementCases: {
    total: 1,
    rows: [
      {
        id: 'case-1',
        caseKey: 'CASE-001',
        municipality: 'Kungsbacka',
        authorityType: 'Länsstyrelsen',
        documentType: 'Tillstånd',
        reviewStatus: 'AUTO',
        requirementCount: 15,
        createdAt: new Date().toISOString(),
      },
    ],
  },
  requirements: {
    total: 15,
    rows: [
      {
        id: 'req-1',
        requirementCode: 'REQ-001',
        category: 'Avfall',
        subcategory: 'Farligt avfall',
        level: 'mandatory',
        codingConfidence: 'HIGH',
        statusInNotification: 'Ej behandlad',
        minimumRequirement: false,
        createdAt: new Date().toISOString(),
      },
    ],
  },
  extractedRequirements: {
    total: 5,
    rows: [
      {
        id: 'ext-1',
        municipality: 'Gothenburg',
        documentId: 'doc-1',
        category: 'Vatten',
        subcategory: null,
        requirementLevel: 'mandatory',
        confidence: 0.87,
        parsedAt: new Date().toISOString(),
      },
    ],
  },
  emailMessages: {
    total: 4,
    rows: [
      {
        messageId: 'msg-1',
        sender: 'test@example.com',
        subject: 'Tillstånd bilagor',
        status: 'PROCESSED',
        attachmentCount: 2,
        createdAt: new Date().toISOString(),
      },
    ],
  },
  pipelineRuns: {
    total: 2,
    rows: [
      {
        id: 'run-1',
        status: 'SUCCESS',
        messagesIngested: 4,
        errors: 1,
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
      },
    ],
  },
};

vi.mock('../../server/repositories/adminReportRepository', () => ({
  getAdminExamSummary: vi.fn(),
  getAdminDatabaseDump: vi.fn(),
  getExternalHealth: vi.fn(),
  getDbStats: vi.fn(),
  getDbAnalysis: vi.fn(),
  getDbContents: vi.fn(async () => mockContents),
}));

const app = createApp();

function adminAuthHeader() {
  const token = createTokenPair({
    id: 'test-admin-id',
    organisationId: 'test-org-id',
    bankidId: 'admin:admin',
    role: 'ADMIN',
  }).accessToken;
  return `Bearer ${token}`;
}

function consultantAuthHeader() {
  const token = createTokenPair({
    id: 'test-user-id',
    organisationId: 'test-org-id',
    bankidId: 'bankid:user',
    role: 'CONSULTANT',
  }).accessToken;
  return `Bearer ${token}`;
}

describe('GET /api/admin/db-contents', () => {
  it('returns 401 without auth token', async () => {
    const res = await request(app).get('/api/admin/db-contents');
    expect(res.status).toBe(401);
  });

  it('returns 403 for non-admin users', async () => {
    const res = await request(app).get('/api/admin/db-contents').set('Authorization', consultantAuthHeader());
    expect(res.status).toBe(403);
  });

  it('returns 200 with correct top-level shape for admin', async () => {
    const res = await request(app).get('/api/admin/db-contents').set('Authorization', adminAuthHeader());

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    const c = res.body.contents;
    expect(c).toBeDefined();
    expect(typeof c.generatedAt).toBe('string');
    expect(typeof c.limit).toBe('number');
  });

  it('returns all eight table sections', async () => {
    const res = await request(app).get('/api/admin/db-contents').set('Authorization', adminAuthHeader());

    const c = res.body.contents;
    expect(c.organisations).toBeDefined();
    expect(c.projects).toBeDefined();
    expect(c.documents).toBeDefined();
    expect(c.requirementCases).toBeDefined();
    expect(c.requirements).toBeDefined();
    expect(c.extractedRequirements).toBeDefined();
    expect(c.emailMessages).toBeDefined();
    expect(c.pipelineRuns).toBeDefined();
  });

  it('each section has total and rows array', async () => {
    const res = await request(app).get('/api/admin/db-contents').set('Authorization', adminAuthHeader());

    const c = res.body.contents;
    for (const key of [
      'organisations',
      'projects',
      'documents',
      'requirementCases',
      'requirements',
      'extractedRequirements',
      'emailMessages',
      'pipelineRuns',
    ]) {
      expect(typeof c[key].total).toBe('number');
      expect(Array.isArray(c[key].rows)).toBe(true);
    }
  });

  it('returns correct document row data', async () => {
    const res = await request(app).get('/api/admin/db-contents').set('Authorization', adminAuthHeader());

    const docRow = res.body.contents.documents.rows[0];
    expect(docRow.id).toBe('doc-1');
    expect(docRow.subject).toBe('Tillstånd Kungsbacka');
    expect(docRow.status).toBe('COMPLETE');
    expect(docRow.municipality).toBe('Kungsbacka');
  });

  it('returns correct requirement row data including codingConfidence', async () => {
    const res = await request(app).get('/api/admin/db-contents').set('Authorization', adminAuthHeader());

    const reqRow = res.body.contents.requirements.rows[0];
    expect(reqRow.requirementCode).toBe('REQ-001');
    expect(reqRow.category).toBe('Avfall');
    expect(reqRow.codingConfidence).toBe('HIGH');
    expect(typeof reqRow.minimumRequirement).toBe('boolean');
  });

  it('returns correct pipeline run row data', async () => {
    const res = await request(app).get('/api/admin/db-contents').set('Authorization', adminAuthHeader());

    const runRow = res.body.contents.pipelineRuns.rows[0];
    expect(runRow.status).toBe('SUCCESS');
    expect(runRow.messagesIngested).toBe(4);
    expect(runRow.errors).toBe(1);
  });
});
