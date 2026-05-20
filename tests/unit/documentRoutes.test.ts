import { Readable } from 'node:stream';
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTokenPair } from '../../server/security/auth';

const mocks = vi.hoisted(() => ({
  uploadDocumentToProject: vi.fn(),
  getDocumentById: vi.fn(),
  deleteDocumentById: vi.fn(),
  assertProjectMembership: vi.fn(),
  appendDomainAudit: vi.fn(),
  storageFileExists: vi.fn(() => true),
  createStorageReadStream: vi.fn(),
  deleteStorageFile: vi.fn(),
}));

vi.mock('../../server/services/documentObjectStorage', () => ({
  storageFileExists: mocks.storageFileExists,
  createStorageReadStream: mocks.createStorageReadStream,
  deleteStorageFile: mocks.deleteStorageFile,
}));

vi.mock('../../server/repositories/tokenRepository', () => ({
  isTokenRevoked: vi.fn(async () => false),
  markRefreshTokenAsUsed: vi.fn(async () => undefined),
  revokeRefreshToken: vi.fn(async () => undefined),
  cleanupExpiredTokenRevocations: vi.fn(async () => 0),
}));

vi.mock('../../server/modules/documents/public', () => ({
  uploadDocumentToProject: mocks.uploadDocumentToProject,
}));

vi.mock('../../server/modules/search/public', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../server/modules/search/public')>();
  return {
    ...mod,
    getDocumentById: mocks.getDocumentById,
    deleteDocumentById: mocks.deleteDocumentById,
  };
});

vi.mock('../../server/modules/project/public', () => ({
  assertProjectMembership: mocks.assertProjectMembership,
}));

vi.mock('../../server/security/auditTrail', () => ({
  appendDomainAudit: mocks.appendDomainAudit,
}));

import documentRoutes from '../../server/routes/document.routes';

const app = express();
app.use(express.json());
app.use(documentRoutes);

function authHeader() {
  return `Bearer ${
    createTokenPair({
      id: 'user-1',
      organisationId: 'org-1',
      bankidId: '191212121212',
      role: 'ADMIN',
    }).accessToken
  }`;
}

function fakeDoc(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    projectId: 10,
    absolutePath: '/var/files/doc.pdf',
    originalName: 'dok.pdf',
    mimeType: 'application/pdf',
    deletedSearchJobs: 0,
    ...overrides,
  };
}

describe('document.routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertProjectMembership.mockResolvedValue(undefined);
    mocks.appendDomainAudit.mockResolvedValue({ id: 'audit-1' });
    mocks.storageFileExists.mockResolvedValue(true);
    mocks.createStorageReadStream.mockReturnValue(Readable.from(['file content']));
    mocks.uploadDocumentToProject.mockResolvedValue({
      document: { id: 1, originalName: 'fil.pdf' },
      searchJobId: 'job-1',
      auditId: 'audit-1',
    });
  });

  // ─── POST /api/documents/upload ───────────────────────────────────────────

  describe('POST /api/documents/upload', () => {
    it('rejects unauthenticated requests', async () => {
      const res = await request(app)
        .post('/api/documents/upload?projectId=p1&originalName=fil.pdf')
        .set('Content-Type', 'application/pdf')
        .send(Buffer.from('data'));

      expect(res.status).toBe(401);
    });

    it('returns 400 when projectId is missing', async () => {
      const res = await request(app)
        .post('/api/documents/upload?originalName=fil.pdf')
        .set('Authorization', authHeader())
        .set('Content-Type', 'application/pdf')
        .send(Buffer.from('data'));

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/projectId/i);
    });

    it('returns 400 when originalName is missing', async () => {
      const res = await request(app)
        .post('/api/documents/upload?projectId=proj-1')
        .set('Authorization', authHeader())
        .set('Content-Type', 'application/pdf')
        .send(Buffer.from('data'));

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/originalName/i);
    });

    it('returns 400 when body is empty', async () => {
      const res = await request(app)
        .post('/api/documents/upload?projectId=proj-1&originalName=fil.pdf')
        .set('Authorization', authHeader())
        .set('Content-Type', 'application/pdf')
        .send(Buffer.alloc(0));

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/file body/i);
    });

    it('uploads successfully and returns 201 with document metadata', async () => {
      const res = await request(app)
        .post('/api/documents/upload?projectId=proj-1&originalName=fil.pdf&subject=Ansökan')
        .set('Authorization', authHeader())
        .set('Content-Type', 'application/pdf')
        .send(Buffer.from('pdf bytes'));

      expect(res.status).toBe(201);
      expect(res.body.ok).toBe(true);
      expect(res.body.searchJobId).toBe('job-1');
      expect(mocks.uploadDocumentToProject).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: 'proj-1',
          originalName: 'fil.pdf',
          subject: 'Ansökan',
        }),
      );
    });

    it('returns 5xx when upload service throws an unexpected error', async () => {
      mocks.uploadDocumentToProject.mockRejectedValueOnce(new Error('disk full'));
      const res = await request(app)
        .post('/api/documents/upload?projectId=proj-1&originalName=fil.pdf')
        .set('Authorization', authHeader())
        .set('Content-Type', 'application/pdf')
        .send(Buffer.from('data'));

      expect(res.status).toBeGreaterThanOrEqual(500);
    });
  });

  // ─── GET /api/documents/:documentId/view ──────────────────────────────────

  describe('GET /api/documents/:documentId/view', () => {
    it('rejects unauthenticated requests', async () => {
      const res = await request(app).get('/api/documents/doc-1/view');
      expect(res.status).toBe(401);
    });

    it('returns 404 when document is not in the database', async () => {
      mocks.getDocumentById.mockResolvedValueOnce(null);
      const res = await request(app).get('/api/documents/doc-1/view').set('Authorization', authHeader());

      expect(res.status).toBe(404);
    });

    it('returns 404 when absolutePath is missing from the document record', async () => {
      mocks.getDocumentById.mockResolvedValueOnce(fakeDoc({ absolutePath: null }));
      const res = await request(app).get('/api/documents/doc-1/view').set('Authorization', authHeader());

      expect(res.status).toBe(404);
    });

    it('returns 404 when the physical file is absent on disk', async () => {
      mocks.getDocumentById.mockResolvedValueOnce(fakeDoc());
      mocks.storageFileExists.mockReturnValueOnce(false);
      const res = await request(app).get('/api/documents/doc-1/view').set('Authorization', authHeader());

      expect(res.status).toBe(404);
      expect(res.body.error).toMatch(/missing/i);
    });

    it('streams the document with correct headers for authenticated member', async () => {
      mocks.getDocumentById.mockResolvedValueOnce(fakeDoc());
      const res = await request(app).get('/api/documents/doc-1/view').set('Authorization', authHeader());

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/application\/pdf/);
      expect(res.headers['content-disposition']).toMatch(/inline/);
      expect(mocks.appendDomainAudit).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'DOCUMENT_VIEW' }),
      );
    });

    it('falls back to octet-stream mime when mimeType is null', async () => {
      mocks.getDocumentById.mockResolvedValueOnce(fakeDoc({ mimeType: null }));
      const res = await request(app).get('/api/documents/doc-1/view').set('Authorization', authHeader());

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/octet-stream/);
    });
  });

  // ─── GET /api/documents/:documentId/download ──────────────────────────────

  describe('GET /api/documents/:documentId/download', () => {
    it('rejects unauthenticated requests', async () => {
      const res = await request(app).get('/api/documents/doc-1/download');
      expect(res.status).toBe(401);
    });

    it('returns 404 when document is not found', async () => {
      mocks.getDocumentById.mockResolvedValueOnce(null);
      const res = await request(app).get('/api/documents/doc-1/download').set('Authorization', authHeader());

      expect(res.status).toBe(404);
    });

    it('returns 404 when file is missing from disk', async () => {
      mocks.getDocumentById.mockResolvedValueOnce(fakeDoc());
      mocks.storageFileExists.mockReturnValueOnce(false);
      const res = await request(app).get('/api/documents/doc-1/download').set('Authorization', authHeader());

      expect(res.status).toBe(404);
    });

    it('streams file with Content-Disposition: attachment', async () => {
      mocks.getDocumentById.mockResolvedValueOnce(fakeDoc());
      const res = await request(app).get('/api/documents/doc-1/download').set('Authorization', authHeader());

      expect(res.status).toBe(200);
      expect(res.headers['content-disposition']).toMatch(/attachment/);
      expect(mocks.appendDomainAudit).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'DOCUMENT_DOWNLOAD' }),
      );
    });
  });

  // ─── DELETE /api/documents/:documentId ────────────────────────────────────

  describe('DELETE /api/documents/:documentId', () => {
    it('rejects unauthenticated requests', async () => {
      const res = await request(app).delete('/api/documents/doc-1');
      expect(res.status).toBe(401);
    });

    it('returns 404 when getDocumentById finds nothing', async () => {
      mocks.getDocumentById.mockResolvedValueOnce(null);
      const res = await request(app).delete('/api/documents/doc-1').set('Authorization', authHeader());

      expect(res.status).toBe(404);
    });

    it('returns 404 when deleteDocumentById returns null', async () => {
      mocks.getDocumentById.mockResolvedValueOnce(fakeDoc());
      mocks.deleteDocumentById.mockResolvedValueOnce(null);
      const res = await request(app).delete('/api/documents/doc-1').set('Authorization', authHeader());

      expect(res.status).toBe(404);
    });

    it('deletes the document and its physical file when absolutePath exists', async () => {
      mocks.getDocumentById.mockResolvedValueOnce(fakeDoc());
      mocks.deleteDocumentById.mockResolvedValueOnce(fakeDoc());
      const res = await request(app).delete('/api/documents/doc-1').set('Authorization', authHeader());

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.fileDeleted).toBe(true);
      expect(mocks.deleteStorageFile).toHaveBeenCalledWith('/var/files/doc.pdf');
    });

    it('deletes without touching disk when absolutePath is null', async () => {
      mocks.getDocumentById.mockResolvedValueOnce(fakeDoc());
      mocks.deleteDocumentById.mockResolvedValueOnce(fakeDoc({ absolutePath: null }));
      const res = await request(app).delete('/api/documents/doc-1').set('Authorization', authHeader());

      expect(res.status).toBe(200);
      expect(res.body.fileDeleted).toBe(false);
      expect(mocks.deleteStorageFile).not.toHaveBeenCalled();
    });

    it('deletes without touching disk when physical file does not exist', async () => {
      mocks.getDocumentById.mockResolvedValueOnce(fakeDoc());
      mocks.deleteDocumentById.mockResolvedValueOnce(fakeDoc());
      mocks.storageFileExists.mockResolvedValueOnce(false);
      const res = await request(app).delete('/api/documents/doc-1').set('Authorization', authHeader());

      expect(res.status).toBe(200);
      expect(res.body.fileDeleted).toBe(false);
    });

    it('surfaces service errors as 5xx for unexpected errors', async () => {
      mocks.getDocumentById.mockResolvedValueOnce(fakeDoc());
      mocks.deleteDocumentById.mockRejectedValueOnce(new Error('DB constraint'));
      const res = await request(app).delete('/api/documents/doc-1').set('Authorization', authHeader());

      expect(res.status).toBeGreaterThanOrEqual(500);
    });

    it('emits a DOCUMENT_DELETE audit event with fileDeleted flag', async () => {
      mocks.getDocumentById.mockResolvedValueOnce(fakeDoc());
      mocks.deleteDocumentById.mockResolvedValueOnce(fakeDoc());
      await request(app).delete('/api/documents/doc-1').set('Authorization', authHeader());

      expect(mocks.appendDomainAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'DOCUMENT_DELETE',
          payload: expect.objectContaining({ fileDeleted: true }),
        }),
      );
    });
  });
});
