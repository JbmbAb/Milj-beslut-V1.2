import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTokenPair } from '../../server/security/auth';

function binaryBodyParser(res: any, callback: (err: Error | null, body: Buffer) => void) {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
  res.on('end', () => callback(null, Buffer.concat(chunks)));
}

const prismaMock = vi.hoisted(() => ({
  projectFindFirst: vi.fn(),
  draftCreate: vi.fn(),
  draftFindFirst: vi.fn(),
}));

vi.mock('../../server/repositories/tokenRepository', () => ({
  isTokenRevoked: vi.fn(async () => false),
  markRefreshTokenAsUsed: vi.fn(async () => undefined),
  revokeRefreshToken: vi.fn(async () => undefined),
  cleanupExpiredTokenRevocations: vi.fn(async () => 0),
}));

vi.mock('../../server/db/prisma', () => ({
  prisma: {
    project: { findFirst: (...a: unknown[]) => prismaMock.projectFindFirst(...a) },
    permitApplicationDraft: {
      create: (...a: unknown[]) => prismaMock.draftCreate(...a),
      findFirst: (...a: unknown[]) => prismaMock.draftFindFirst(...a),
    },
  },
}));

import adminPermitApplicationRoutes from '../../server/routes/admin.v1.routes';

const app = express();
app.use(express.json());
app.use(adminPermitApplicationRoutes);

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

describe.skip('admin.permit-application routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.projectFindFirst.mockResolvedValue({ id: 'proj-1' });
    prismaMock.draftCreate.mockResolvedValue({ id: 'draft-new-1' });
    prismaMock.draftFindFirst.mockResolvedValue(null);
  });

  describe('POST /api/projects/:projectId/permit', () => {
    it('sparar utkast och returnerar applicationId', async () => {
      const res = await request(app)
        .post('/api/projects/proj-1/permit')
        .set('Authorization', authHeader())
        .send({
          application: { title: 'Ansökan', sniCode: '38.21.10' },
          generatedAt: new Date().toISOString(),
          sourceTracking: [],
          externalSourcesUsed: ['SGU'],
        });

      expect(res.status).toBe(201);
      expect(res.body.ok).toBe(true);
      expect(res.body.applicationId).toBe('draft-new-1');
      expect(prismaMock.draftCreate).toHaveBeenCalled();
    });

    it('returnerar 404 om projekt inte tillhör organisationen', async () => {
      prismaMock.projectFindFirst.mockResolvedValueOnce(null);
      const res = await request(app)
        .post('/api/projects/proj-1/permit')
        .set('Authorization', authHeader())
        .send({
          application: { title: 'Ansökan' },
        });

      expect(res.status).toBe(404);
      expect(prismaMock.draftCreate).not.toHaveBeenCalled();
    });

    it('returnerar 400 om application saknas', async () => {
      const res = await request(app)
        .post('/api/projects/proj-1/permit')
        .set('Authorization', authHeader())
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.ok).toBe(false);
    });

    it('returnerar 401 utan autentisering', async () => {
      const res = await request(app)
        .post('/api/projects/proj-1/permit')
        .send({ application: { title: 'Test' } });

      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/projects/:projectId/permit/:applicationId', () => {
    it('returnerar sparad ansökan', async () => {
      prismaMock.draftFindFirst.mockResolvedValueOnce({
        application: { title: 'Ansökan', sniCode: '38.21.10' },
        generatedAt: new Date('2020-01-01T00:00:00.000Z'),
        sourceTracking: [],
        externalSourcesUsed: ['SGU'],
      });
      const res = await request(app)
        .get('/api/projects/proj-1/permit/permit-app-1')
        .set('Authorization', authHeader());

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.application?.title).toBe('Ansökan');
      expect(res.body.externalSourcesUsed).toEqual(['SGU']);
    });

    it('returnerar 404 om utkast saknas', async () => {
      prismaMock.draftFindFirst.mockResolvedValueOnce(null);
      const res = await request(app)
        .get('/api/projects/proj-1/permit/saknad-id')
        .set('Authorization', authHeader());

      expect(res.status).toBe(404);
      expect(res.body.ok).toBe(false);
    });

    it('returnerar 401 utan autentisering', async () => {
      const res = await request(app).get('/api/projects/proj-1/permit/permit-app-1');
      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/projects/:projectId/permit/:applicationId/export', () => {
    it('genererar PDF (utkast från body eller standardtext)', async () => {
      const res = await request(app)
        .post('/api/projects/proj-1/permit/permit-app-1/export')
        .parse(binaryBodyParser)
        .set('Authorization', authHeader())
        .send({ format: 'pdf' });

      expect(res.status).toBe(200);
      expect(String(res.headers['content-type'] || '')).toContain('application/pdf');
      expect(Buffer.isBuffer(res.body)).toBe(true);
      const buf = res.body as Buffer;
      expect(buf.subarray(0, 4).toString('latin1')).toBe('%PDF');
    });

    it('genererar DOCX när format är docx', async () => {
      const res = await request(app)
        .post('/api/projects/proj-1/permit/permit-app-1/export')
        .parse(binaryBodyParser)
        .set('Authorization', authHeader())
        .send({ format: 'docx', draftText: 'Rubrik\n\nBrödtext.' });

      expect(res.status).toBe(200);
      expect(String(res.headers['content-type'] || '')).toContain(
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      );
      expect(Buffer.isBuffer(res.body)).toBe(true);
      const buf = res.body as Buffer;
      expect(buf.length).toBeGreaterThan(200);
      expect(buf.subarray(0, 2).toString('latin1')).toBe('PK');
    });

    it('returnerar 400 för ogiltigt format', async () => {
      const res = await request(app)
        .post('/api/projects/proj-1/permit/permit-app-1/export')
        .set('Authorization', authHeader())
        .send({ format: 'rtf' });

      expect(res.status).toBe(400);
    });

    it('returnerar 401 utan autentisering', async () => {
      const res = await request(app)
        .post('/api/projects/proj-1/permit/permit-app-1/export')
        .send({ format: 'pdf' });

      expect(res.status).toBe(401);
    });
  });
});