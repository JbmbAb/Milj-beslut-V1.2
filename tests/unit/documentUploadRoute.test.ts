import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTokenPair } from '../../server/security/auth';
import { createApp } from '../../server/createApp';

const { uploadDocumentToProject, assertProjectMembership } = vi.hoisted(() => ({
  uploadDocumentToProject: vi.fn(),
  assertProjectMembership: vi.fn(),
}));

// Bypass CSRF for route unit tests that use createApp()
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

vi.mock('../../server/repositories/projectAccessRepository', () => ({
  assertProjectMembership,
}));

vi.mock('../../server/services/documentUploadService', () => ({
  uploadDocumentToProject,
}));

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

describe('POST /api/documents/upload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    assertProjectMembership.mockResolvedValue(undefined);
    uploadDocumentToProject.mockResolvedValue({
      document: {
        id: 'doc-1',
        projectId: 'proj-1',
        organisationId: 'org-1',
        originalName: 'test.pdf',
        diskName: 'stored.pdf',
        absolutePath: 'C:/tmp/stored.pdf',
        mimeType: 'application/pdf',
        status: 'METADATA_ONLY',
        fileSize: 9,
        fileSha256: 'abc123',
        receivedTime: '2026-03-20T12:00:00.000Z',
        subject: 'Test subject',
      },
      searchJobId: 'job-1',
      auditId: 'audit-1',
    });
  });

  it('returns 401 without bearer token', async () => {
    const res = await request(app)
      .post('/api/documents/upload?projectId=proj-1&originalName=test.pdf')
      .set('Content-Type', 'application/pdf')
      .send(Buffer.from('pdf-data'));

    expect(res.status).toBe(401);
    expect(res.body?.ok).toBe(false);
  });

  it('returns 400 when projectId is missing', async () => {
    const res = await request(app)
      .post('/api/documents/upload?originalName=test.pdf')
      .set('Authorization', authHeader())
      .set('Content-Type', 'application/pdf')
      .send(Buffer.from('pdf-data'));

    expect(res.status).toBe(400);
    expect(String(res.body?.error || '')).toMatch(/projectId is required/i);
  });

  it('returns 400 when file body is missing', async () => {
    const res = await request(app)
      .post('/api/documents/upload?projectId=proj-1&originalName=test.pdf')
      .set('Authorization', authHeader())
      .set('Content-Type', 'application/pdf')
      .send(Buffer.alloc(0));

    expect(res.status).toBe(400);
    expect(String(res.body?.error || '')).toMatch(/file body is required/i);
  });

  it('returns 500 when uploadDocumentToProject throws', async () => {
    uploadDocumentToProject.mockRejectedValueOnce(new Error('Storage unavailable'));

    const res = await request(app)
      .post('/api/documents/upload?projectId=proj-1&originalName=test.pdf')
      .set('Authorization', authHeader())
      .set('Content-Type', 'application/pdf')
      .send(Buffer.from('pdf-data'));

    expect(res.status).toBe(500);
    expect(res.body?.ok).toBe(false);
  });

  it('returns 403 when assertProjectMembership throws', async () => {
    const { SecureError } = await import('../../server/security/secureErrors');
    assertProjectMembership.mockRejectedValueOnce(new SecureError('Not a member', 'Access denied', 403));

    const res = await request(app)
      .post('/api/documents/upload?projectId=proj-1&originalName=test.pdf')
      .set('Authorization', authHeader())
      .set('Content-Type', 'application/pdf')
      .send(Buffer.from('pdf-data'));

    expect(res.status).toBe(403);
    expect(res.body?.ok).toBe(false);
  });
});
