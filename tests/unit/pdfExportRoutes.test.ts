import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createTokenPair } from '../../server/security/auth';

vi.mock('../../server/repositories/tokenRepository', () => ({
  isTokenRevoked: vi.fn(async () => false),
  markRefreshTokenAsUsed: vi.fn(async () => undefined),
  revokeRefreshToken: vi.fn(async () => undefined),
  cleanupExpiredTokenRevocations: vi.fn(async () => 0),
}));

import pdfExportRoutes from '../../server/routes/pdf-export.routes';

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(pdfExportRoutes);

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

function asBuffer(body: unknown): Buffer {
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof ArrayBuffer) return Buffer.from(body);
  return Buffer.from(String(body));
}

describe('pdf-export.routes', () => {
  it('POST /api/export/pdf-json returns a PDF buffer', async () => {
    const res = await request(app)
      .post('/api/export/pdf-json')
      .set('Authorization', authHeader())
      .send({ title: 'Projektplan', subtitle: 'Utkast', json: { avsnitt: ['a', 'b'] } });

    expect(res.status).toBe(200);
    expect(String(res.headers['content-type'] || '')).toContain('application/pdf');
    expect(asBuffer(res.body).subarray(0, 4).toString('latin1')).toBe('%PDF');
  });

  it('POST /api/export/pdf-json requires json or data', async () => {
    const res = await request(app)
      .post('/api/export/pdf-json')
      .set('Authorization', authHeader())
      .send({ title: 'X' });

    expect(res.status).toBe(400);
  });

  it('POST /api/export/pdf-text requires body', async () => {
    const res = await request(app)
      .post('/api/export/pdf-text')
      .set('Authorization', authHeader())
      .send({ title: 'X' });

    expect(res.status).toBe(400);
  });

  it('POST /api/export/pdf-text returns PDF', async () => {
    const res = await request(app)
      .post('/api/export/pdf-text')
      .set('Authorization', authHeader())
      .send({ title: 'Sammanfattning', body: 'Stycke ett.\n\nStycke två.' });

    expect(res.status).toBe(200);
    expect(asBuffer(res.body).subarray(0, 4).toString('latin1')).toBe('%PDF');
  });
});
