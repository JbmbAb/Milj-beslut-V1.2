import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTokenPair } from '../../server/security/auth';
import { createApp } from '../../server/createApp';

const { assertProjectMembership, getDocumentById, deleteDocumentById, appendDomainAudit } = vi.hoisted(
  () => ({
    assertProjectMembership: vi.fn(),
    getDocumentById: vi.fn(),
    deleteDocumentById: vi.fn(),
    appendDomainAudit: vi.fn(),
  }),
);

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

vi.mock('../../server/repositories/projectAccessRepository', () => ({
  assertProjectMembership,
}));

vi.mock('../../server/repositories/searchRepository', () => ({
  createOrGetAdminProject: vi.fn(),
  deleteDocumentById,
  enqueueSearchJob: vi.fn(),
  getSearchStatus: vi.fn(),
  listProjectsForAdmin: vi.fn(),
  recoverStaleRunningJobs: vi.fn(),
  requeueFailedJobs: vi.fn(),
  getDocumentById,
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

const app = createApp();

function authHeader() {
  const token = createTokenPair({
    id: 'test-admin-id',
    organisationId: 'org-1',
    bankidId: 'admin:admin',
    role: 'ADMIN',
  }).accessToken;
  return `Bearer ${token}`;
}

describe('GET /api/documents/:documentId/view', () => {
  let tempDir = '';
  let tempFile = '';

  beforeEach(() => {
    vi.clearAllMocks();
    assertProjectMembership.mockResolvedValue(undefined);
    appendDomainAudit.mockResolvedValue({ id: 'audit-1' });
    deleteDocumentById.mockResolvedValue({
      id: 'doc-1',
      projectId: 'proj-1',
      organisationId: 'org-1',
      originalName: 'ansokan.pdf',
      absolutePath: '',
      mimeType: 'application/pdf',
      deletedSearchJobs: 1,
    });

    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'miljobeslut-doc-view-'));
    tempFile = path.join(tempDir, 'ansokan.pdf');
    fs.writeFileSync(tempFile, Buffer.from('pdf-data'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns 401 without bearer token', async () => {
    const res = await request(app).get('/api/documents/doc-1/view');
    expect(res.status).toBe(401);
  });

  it('returns 404 when document is missing', async () => {
    getDocumentById.mockResolvedValue(null);

    const res = await request(app).get('/api/documents/doc-1/view').set('Authorization', authHeader());

    expect(res.status).toBe(404);
    expect(String(res.body?.error || '')).toMatch(/Document not found/i);
  });

  it('streams the document for authorized project members', async () => {
    getDocumentById.mockResolvedValue({
      id: 'doc-1',
      projectId: 'proj-1',
      organisationId: 'org-1',
      originalName: 'ansokan.pdf',
      absolutePath: tempFile,
      mimeType: 'application/pdf',
    });

    const res = await request(app).get('/api/documents/doc-1/view').set('Authorization', authHeader());

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(assertProjectMembership).toHaveBeenCalledWith({
      projectId: 'proj-1',
      userId: 'test-admin-id',
      organisationId: 'org-1',
      role: 'ADMIN',
    });
    expect(appendDomainAudit).toHaveBeenCalledTimes(1);
    expect(Buffer.from(res.body).toString('utf8')).toBe('pdf-data');
  });

  it('downloads the document for authorized project members', async () => {
    getDocumentById.mockResolvedValue({
      id: 'doc-1',
      projectId: 'proj-1',
      organisationId: 'org-1',
      originalName: 'ansokan.pdf',
      absolutePath: tempFile,
      mimeType: 'application/pdf',
    });

    const res = await request(app).get('/api/documents/doc-1/download').set('Authorization', authHeader());

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(String(res.headers['content-disposition'] || '')).toContain('attachment;');
    expect(appendDomainAudit).toHaveBeenCalledTimes(1);
  });

  it('deletes the document for authorized project members', async () => {
    getDocumentById.mockResolvedValue({
      id: 'doc-1',
      projectId: 'proj-1',
      organisationId: 'org-1',
      originalName: 'ansokan.pdf',
      absolutePath: tempFile,
      mimeType: 'application/pdf',
    });

    const res = await request(app).delete('/api/documents/doc-1').set('Authorization', authHeader());

    expect(res.status).toBe(200);
    expect(res.body?.ok).toBe(true);
    expect(res.body?.documentId).toBe('doc-1');
    expect(deleteDocumentById).toHaveBeenCalledWith('doc-1');
    expect(appendDomainAudit).toHaveBeenCalledTimes(1);
  });
});
