import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTokenPair } from '../../server/security/auth';

const mocks = vi.hoisted(() => ({
  listRequirementCases: vi.fn(),
  listRequirementRows: vi.fn(),
  listRequirementCitations: vi.fn(),
  updateRequirementCaseReview: vi.fn(),
  updateRequirementVerification: vi.fn(),
  updateCitationVerification: vi.fn(),
  buildRequirementsDocxBuffer: vi.fn(),
  buildRequirementsExportCsvZip: vi.fn(),
  buildRequirementsReportSummary: vi.fn(),
  exportFilename: vi.fn(),
  getSearchDocumentById: vi.fn(),
  appendDomainAudit: vi.fn(),
  existsSync: vi.fn(),
  createReadStream: vi.fn(),
}));

vi.mock('../../server/repositories/tokenRepository', () => ({
  isTokenRevoked: vi.fn(async () => false),
  markRefreshTokenAsUsed: vi.fn(async () => undefined),
  revokeRefreshToken: vi.fn(async () => undefined),
  cleanupExpiredTokenRevocations: vi.fn(async () => 0),
}));

vi.mock('../../server/repositories/requirementsRepository', () => ({
  listRequirementCases: mocks.listRequirementCases,
  listRequirementRows: mocks.listRequirementRows,
  listRequirementCitations: mocks.listRequirementCitations,
  updateRequirementCaseReview: mocks.updateRequirementCaseReview,
  updateRequirementVerification: mocks.updateRequirementVerification,
  updateCitationVerification: mocks.updateCitationVerification,
}));

vi.mock('../../server/services/requirementsReportService', () => ({
  buildRequirementsDocxBuffer: mocks.buildRequirementsDocxBuffer,
  buildRequirementsExportCsvZip: mocks.buildRequirementsExportCsvZip,
  buildRequirementsReportSummary: mocks.buildRequirementsReportSummary,
  exportFilename: mocks.exportFilename,
}));

vi.mock('../../server/repositories/searchRepository', () => ({
  getDocumentById: mocks.getSearchDocumentById,
}));

vi.mock('../../server/security/auditTrail', () => ({
  appendDomainAudit: mocks.appendDomainAudit,
}));

vi.mock('node:fs', () => {
  const api = {
    existsSync: mocks.existsSync,
    createReadStream: mocks.createReadStream,
  };

  return {
    default: api,
    existsSync: mocks.existsSync,
    createReadStream: mocks.createReadStream,
  };
});

import requirementsRoutes from '../../server/routes/requirements.routes';

const app = express();
app.use(express.json());
app.use(requirementsRoutes);

function authHeader(role: 'ADMIN' | 'CONSULTANT' = 'ADMIN') {
  return `Bearer ${
    createTokenPair({
      id: role === 'ADMIN' ? 'admin-1' : 'user-1',
      organisationId: 'org-1',
      bankidId: role === 'ADMIN' ? 'admin:one' : 'consultant:one',
      role,
    }).accessToken
  }`;
}

function pipeable(payload: Buffer | string) {
  return {
    pipe: (destination: { end: (body: Buffer | string) => void }) => {
      destination.end(payload);
      return destination;
    },
  };
}

describe('requirements.routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.listRequirementCases.mockResolvedValue({
      items: [{ id: 'case-1' }],
      total: 1,
      page: 2,
      pageSize: 50,
    });
    mocks.listRequirementRows.mockResolvedValue({
      items: [{ id: 'row-1' }],
      total: 1,
      page: 1,
      pageSize: 25,
    });
    mocks.listRequirementCitations.mockResolvedValue({
      items: [{ id: 'citation-1' }],
      total: 1,
      page: 1,
      pageSize: 25,
    });
    mocks.updateRequirementCaseReview.mockResolvedValue({
      id: 'case-1',
      caseKey: 'CASE-1',
      caseReviewStatus: 'VERIFIED',
      reviewStatus: 'VERIFIED',
      validatedBy: 'Anna Admin',
    });
    mocks.updateRequirementVerification.mockResolvedValue({
      id: 'row-1',
      requirementCode: 'REQ-1',
      verificationStatus: 'VERIFIED',
      verifiedBy: 'Anna Admin',
    });
    mocks.updateCitationVerification.mockResolvedValue({
      id: 'citation-1',
      citationCode: 'CIT-1',
      verificationStatus: 'VERIFIED',
      verifiedBy: 'Anna Admin',
    });
    mocks.buildRequirementsReportSummary.mockResolvedValue({
      summary: { verified: 10, pending: 2 },
    });
    mocks.buildRequirementsExportCsvZip.mockResolvedValue(pipeable('zip-body'));
    mocks.buildRequirementsDocxBuffer.mockResolvedValue(Buffer.from('docx-body'));
    mocks.exportFilename.mockReturnValue('kravrapport-export.bin');
    mocks.getSearchDocumentById.mockResolvedValue(null);
    mocks.appendDomainAudit.mockResolvedValue({ id: 'audit-1' });
    mocks.existsSync.mockReturnValue(true);
    mocks.createReadStream.mockReturnValue(pipeable('pdf-body'));
  });

  it('guards admin access and parses case filters', async () => {
    const forbidden = await request(app)
      .get('/api/admin/requirements/cases')
      .set('Authorization', authHeader('CONSULTANT'));

    expect(forbidden.status).toBe(403);

    const res = await request(app)
      .get(
        '/api/admin/requirements/cases?page=2&pageSize=50&municipality=Orsa&documentType=Anm%C3%A4lan&verificationStatus=VERIFIED',
      )
      .set('Authorization', authHeader('ADMIN'));

    expect(res.status).toBe(200);
    expect(mocks.listRequirementCases).toHaveBeenCalledWith({
      page: 2,
      pageSize: 50,
      organisationId: 'org-1',
      municipality: 'Orsa',
      documentType: 'Anmälan',
      verificationStatus: 'VERIFIED',
    });
  });

  it('parses row and citation filters including boolean flags', async () => {
    const rows = await request(app)
      .get(
        '/api/admin/requirements/rows?page=1&pageSize=10&category=Milj%C3%B6&caseId=CASE-1&requirementCode=REQ-1&includePreliminary=false',
      )
      .set('Authorization', authHeader('ADMIN'));

    expect(rows.status).toBe(200);
    expect(mocks.listRequirementRows).toHaveBeenCalledWith({
      page: 1,
      pageSize: 10,
      organisationId: 'org-1',
      municipality: undefined,
      documentType: undefined,
      category: 'Miljö',
      caseId: 'CASE-1',
      requirementCode: 'REQ-1',
      verificationStatus: undefined,
      includePreliminary: false,
    });

    const citations = await request(app)
      .get('/api/admin/requirements/citations?requirementCode=REQ-1&includePreliminary=0')
      .set('Authorization', authHeader('ADMIN'));

    expect(citations.status).toBe(200);
    expect(mocks.listRequirementCitations).toHaveBeenCalledWith({
      page: 1,
      pageSize: 25,
      organisationId: 'org-1',
      requirementCode: 'REQ-1',
      verificationStatus: undefined,
      includePreliminary: false,
    });
  });

  it('requires validatedBy for manual case review and audits successful reviews', async () => {
    const invalid = await request(app)
      .patch('/api/admin/requirements/cases/case-1/review')
      .set('Authorization', authHeader('ADMIN'))
      .send({
        caseReviewStatus: 'VERIFIED',
      });

    expect(invalid.status).toBe(400);

    const res = await request(app)
      .patch('/api/admin/requirements/cases/case-1/review')
      .set('Authorization', authHeader('ADMIN'))
      .send({
        caseReviewStatus: 'VERIFIED',
        validatedBy: 'Anna Admin',
        notes: 'Looks good',
      });

    expect(res.status).toBe(200);
    expect(mocks.updateRequirementCaseReview).toHaveBeenCalledWith({
      caseId: 'case-1',
      organisationId: 'org-1',
      caseReviewStatus: 'VERIFIED',
      validatedBy: 'Anna Admin',
      notes: 'Looks good',
    });
    expect(mocks.appendDomainAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'RequirementCase',
        action: 'REQUIREMENT_CASE_REVIEW',
      }),
    );
  });

  it('verifies rows and citations while writing audits', async () => {
    const row = await request(app)
      .patch('/api/admin/requirements/rows/REQ-1/verify')
      .set('Authorization', authHeader('ADMIN'))
      .send({
        verificationStatus: 'VERIFIED',
        verifiedBy: 'Anna Admin',
        validationComment: 'Confirmed',
        errorType: 'NONE',
      });

    expect(row.status).toBe(200);
    expect(mocks.updateRequirementVerification).toHaveBeenCalledWith({
      requirementCode: 'REQ-1',
      organisationId: 'org-1',
      verificationStatus: 'VERIFIED',
      verifiedBy: 'Anna Admin',
      validationComment: 'Confirmed',
      errorType: 'NONE',
    });

    const citation = await request(app)
      .patch('/api/admin/requirements/citations/CIT-1/verify')
      .set('Authorization', authHeader('ADMIN'))
      .send({
        verificationStatus: 'VERIFIED',
        verifiedBy: 'Anna Admin',
        comment: 'Relevant',
        pageNumber: 8,
      });

    expect(citation.status).toBe(200);
    expect(mocks.updateCitationVerification).toHaveBeenCalledWith({
      citationCode: 'CIT-1',
      organisationId: 'org-1',
      verificationStatus: 'VERIFIED',
      verifiedBy: 'Anna Admin',
      comment: 'Relevant',
      pageNumber: 8,
    });
  });

  it('handles missing documents and streams existing ones with audit', async () => {
    const missingDoc = await request(app)
      .get('/api/admin/requirements/documents/doc-missing/view')
      .set('Authorization', authHeader('ADMIN'));

    expect(missingDoc.status).toBe(404);

    mocks.getSearchDocumentById.mockResolvedValueOnce({
      id: 'doc-1',
      absolutePath: 'C:/tmp/doc-1.pdf',
      mimeType: 'application/pdf',
      originalName: 'beslut.pdf',
    });

    const found = await request(app)
      .get('/api/admin/requirements/documents/doc-1/view')
      .set('Authorization', authHeader('ADMIN'));

    expect(found.status).toBe(200);
    expect(found.headers['content-type']).toContain('application/pdf');
    expect(mocks.appendDomainAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'DocumentRecord',
        action: 'REQUIREMENT_DOCUMENT_VIEW',
      }),
    );
  });

  it('builds summary and export responses with audit trail', async () => {
    const summary = await request(app)
      .get('/api/admin/requirements/reports/summary?includePreliminary=true')
      .set('Authorization', authHeader('ADMIN'));

    expect(summary.status).toBe(200);
    expect(mocks.buildRequirementsReportSummary).toHaveBeenCalledWith({
      organisationId: 'org-1',
      includePreliminary: true,
    });

    const csv = await request(app)
      .get('/api/admin/requirements/reports/export.csv?includePreliminary=1')
      .set('Authorization', authHeader('ADMIN'));

    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toContain('application/zip');
    expect(mocks.buildRequirementsExportCsvZip).toHaveBeenCalledWith({
      organisationId: 'org-1',
      includePreliminary: true,
    });

    const docx = await request(app)
      .post('/api/admin/requirements/reports/export.docx')
      .set('Authorization', authHeader('ADMIN'))
      .send({ includePreliminary: true });

    expect(docx.status).toBe(200);
    expect(docx.headers['content-type']).toContain(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    expect(mocks.buildRequirementsDocxBuffer).toHaveBeenCalledWith({
      organisationId: 'org-1',
      includePreliminary: true,
    });
    expect(mocks.appendDomainAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'RequirementReport',
      }),
    );
  });
});
