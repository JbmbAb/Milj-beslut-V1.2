import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTokenPair } from '../../server/security/auth';
import { createApp } from '../../server/createApp';

const {
  listRequirementCases,
  listRequirementRows,
  listRequirementCitations,
  updateRequirementCaseReview,
  updateRequirementVerification,
  updateCitationVerification,
  appendDomainAudit,
} = vi.hoisted(() => ({
  listRequirementCases: vi.fn(),
  listRequirementRows: vi.fn(),
  listRequirementCitations: vi.fn(),
  updateRequirementCaseReview: vi.fn(),
  updateRequirementVerification: vi.fn(),
  updateCitationVerification: vi.fn(),
  appendDomainAudit: vi.fn(),
}));

vi.mock('../../server/security/csrf', () => ({
  csrfProtection: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../../server/repositories/userRepository', () => ({
  ensureAdminConsoleUser: vi.fn(async () => ({
    id: 'test-admin-id',
    bankidId: 'admin:admin',
    role: 'ADMIN',
    organisationId: 'org-1',
  })),
  findAuthUserByBankId: vi.fn(async () => null),
}));

vi.mock('../../server/repositories/tokenRepository', () => ({
  isTokenRevoked: vi.fn(async () => false),
  markRefreshTokenAsUsed: vi.fn(async () => undefined),
  revokeRefreshToken: vi.fn(async () => undefined),
  cleanupExpiredTokenRevocations: vi.fn(async () => 0),
}));

vi.mock('../../server/repositories/requirementsRepository', () => ({
  listRequirementCases,
  listRequirementRows,
  listRequirementCitations,
  updateRequirementCaseReview,
  updateRequirementVerification,
  updateCitationVerification,
}));

vi.mock('../../server/security/auditTrail', async () => {
  const actual = await vi.importActual<typeof import('../../server/security/auditTrail')>(
    '../../server/security/auditTrail',
  );
  return {
    ...actual,
    appendDomainAudit,
  };
});

vi.mock('../../server/repositories/searchRepository', () => ({
  getDocumentById: vi.fn(),
}));

vi.mock('../../server/services/requirementsReportService', () => ({
  buildRequirementsDocxBuffer: vi.fn(),
  buildRequirementsExportCsvZip: vi.fn(),
  buildRequirementsReportSummary: vi.fn(),
  exportFilename: vi.fn(() => 'requirements-export.docx'),
}));

const app = createApp();

function authHeader(role: 'ADMIN' | 'CONSULTANT' = 'ADMIN') {
  const token = createTokenPair({
    id: role === 'ADMIN' ? 'test-admin-id' : 'test-consultant-id',
    organisationId: 'org-1',
    bankidId: role === 'ADMIN' ? 'admin:admin' : 'consultant:test',
    role,
  }).accessToken;
  return `Bearer ${token}`;
}

describe('PATCH /api/admin/requirements/cases/:caseId/review', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateRequirementCaseReview.mockImplementation(
      async (input: {
        caseId: string;
        organisationId: string;
        caseReviewStatus: string;
        validatedBy?: string;
        notes?: string;
      }) => {
        if (input.caseReviewStatus !== 'AUTO' && !String(input.validatedBy || '').trim()) {
          throw new Error('validatedBy is required when setting a manual case review status');
        }

        return {
          id: input.caseId,
          caseKey: 'CASE-1',
          projectId: 'proj-1',
          documentId: 'doc-1',
          organisationId: input.organisationId,
          municipality: 'Testkommun',
          authorityType: 'Kommun',
          authorityName: 'Testmyndighet',
          diarienummer: '2026-123',
          documentType: 'Beslut',
          documentDate: '2026-03-20T00:00:00.000Z',
          sourceFile: 'case.pdf',
          sourceSubject: 'Case subject',
          reviewStatus: input.caseReviewStatus === 'AUTO' ? 'AUTO' : 'VERIFIED',
          caseReviewStatus: input.caseReviewStatus,
          validatedBy: input.caseReviewStatus === 'AUTO' ? null : input.validatedBy || null,
          validatedAt: input.caseReviewStatus === 'AUTO' ? null : '2026-03-20T12:00:00.000Z',
          notes: input.notes || null,
          createdAt: '2026-03-20T10:00:00.000Z',
          updatedAt: '2026-03-20T12:00:00.000Z',
        };
      },
    );
    appendDomainAudit.mockResolvedValue({ id: 'audit-1' });
  });

  it('returns 401 without bearer token', async () => {
    const res = await request(app).patch('/api/admin/requirements/cases/case-1/review').send({
      caseReviewStatus: 'VERIFIED',
      validatedBy: 'QA Reviewer',
    });

    expect(res.status).toBe(401);
  });

  it('returns 403 for non-admin users', async () => {
    const res = await request(app)
      .patch('/api/admin/requirements/cases/case-1/review')
      .set('Authorization', authHeader('CONSULTANT'))
      .send({
        caseReviewStatus: 'VERIFIED',
        validatedBy: 'QA Reviewer',
      });

    expect(res.status).toBe(403);
  });

  it('returns 400 when manual status is missing validatedBy', async () => {
    const res = await request(app)
      .patch('/api/admin/requirements/cases/case-1/review')
      .set('Authorization', authHeader())
      .send({
        caseReviewStatus: 'VERIFIED',
      });

    expect(res.status).toBe(400);
    expect(String(res.body?.error || '')).toMatch(/validatedBy is required/i);
  });

  it('accepts AUTO status without validatedBy', async () => {
    const res = await request(app)
      .patch('/api/admin/requirements/cases/case-auto/review')
      .set('Authorization', authHeader())
      .send({
        caseReviewStatus: 'AUTO',
      });

    expect(res.status).toBe(200);
    expect(res.body?.ok).toBe(true);
    expect(res.body?.case?.caseReviewStatus).toBe('AUTO');
    expect(res.body?.case?.validatedBy).toBeNull();
  });

  it('returns 500 when updateRequirementCaseReview throws unexpectedly', async () => {
    updateRequirementCaseReview.mockRejectedValueOnce(new Error('DB unavailable'));

    const res = await request(app)
      .patch('/api/admin/requirements/cases/case-err/review')
      .set('Authorization', authHeader())
      .send({
        caseReviewStatus: 'VERIFIED',
        validatedBy: 'Tester',
      });

    expect(res.status).toBe(500);
    expect(res.body?.ok).toBe(false);
  });
});
