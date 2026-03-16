import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createTokenPair } from '../../server/security/auth';
import { createApp } from '../../server/createApp';

vi.mock('../../server/repositories/userRepository', () => ({
  ensureAdminConsoleUser: vi.fn(async () => ({
    id: 'test-admin-id',
    bankidId: 'admin:admin',
    role: 'ADMIN',
    organisationId: 'test-org-id',
  })),
  findAuthUserByBankId: vi.fn(async () => null),
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

describe('GET /api/search/info', () => {
  it('returns 401 without auth token', async () => {
    const res = await request(app).get('/api/search/info');
    expect(res.status).toBe(401);
  });

  it('returns search info for admin users', async () => {
    const res = await request(app)
      .get('/api/search/info')
      .set('Authorization', adminAuthHeader());

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.info).toBeDefined();
    expect(res.body.info.description).toBeTypeOf('string');
    expect(Array.isArray(res.body.info.modes)).toBe(true);
    expect(res.body.info.modes.length).toBeGreaterThan(0);
    expect(Array.isArray(res.body.info.fullTextFields)).toBe(true);
    expect(Array.isArray(res.body.info.metadataFilterFields)).toBe(true);
    expect(Array.isArray(res.body.info.lexicalMatchFields)).toBe(true);
    expect(res.body.info.queryParameters).toBeDefined();
  });

  it('returns correct search mode IDs', async () => {
    const res = await request(app)
      .get('/api/search/info')
      .set('Authorization', adminAuthHeader());

    const modeIds = res.body.info.modes.map((m: { id: string }) => m.id);
    expect(modeIds).toContain('hybrid');
    expect(modeIds).toContain('semantic');
    expect(modeIds).toContain('lexical');
  });

  it('returns metadata filter fields including municipality and decisionType', async () => {
    const res = await request(app)
      .get('/api/search/info')
      .set('Authorization', adminAuthHeader());

    const fields = res.body.info.metadataFilterFields.map((f: { field: string }) => f.field);
    expect(fields).toContain('municipality');
    expect(fields).toContain('decisionType');
    expect(fields).toContain('wasteType');
    expect(fields).toContain('legalStatus');
    expect(fields).toContain('hazardousFlag');
    expect(fields).toContain('status');
    expect(fields).toContain('dateFrom / dateTo');
  });

  it('returns search info for non-admin authenticated users', async () => {
    const res = await request(app)
      .get('/api/search/info')
      .set('Authorization', consultantAuthHeader());

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});
