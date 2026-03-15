import { beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

vi.mock('../../server/services/lantmaterietService', () => ({
  getLantmaterietOpenMapStatus: vi.fn(async () => ({
    ok: true,
    status: 200,
    endpoint: 'https://mocked.example/open',
    mode: 'open',
    sample: 'mock-sample',
  })),
  lookupPropertyByDesignation: vi.fn(async () => ({
    designation: 'TEST 1:1',
    geometry: { type: 'Point', coordinates: [18.0, 59.0] },
    boundaries: [],
    ownership: { ownerType: 'PRIVATE' },
  })),
}));

vi.mock('../../server/services/sluService', () => ({
  getSluProductStatus: vi.fn(() => [{ product: 'taxonomy', configured: true }]),
  pingSluProduct: vi.fn(async () => ({ ok: true, status: 200 })),
  searchSluObservations: vi.fn(async () => ({ total: 0, rows: [] })),
  callSluProductApi: vi.fn(async () => ({ ok: true })),
}));

import { createApp } from '../../server/createApp';

const app = createApp();

describe('external datasource endpoints use mocks in integration tests', () => {
  let adminToken = '';
  let projectId = '';

  beforeAll(async () => {
    const loginRes = await request(app)
      .post('/api/admin/auth/login')
      .send({
        username: process.env.ADMIN_CONSOLE_USERNAME || 'admin',
        password: process.env.ADMIN_CONSOLE_PASSWORD || 'admin-test-password',
      });

    expect(loginRes.status).toBe(200);
    adminToken = String(loginRes.body.accessToken || '');

    const createProjectRes = await request(app)
      .post('/api/admin/projects')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ propertyDesignation: 'MOCK 1:1' });

    expect(createProjectRes.status).toBe(200);
    projectId = String(createProjectRes.body?.project?.id || '');
    expect(projectId).not.toBe('');
  });

  it('returns mocked Lantmateriet open map status', async () => {
    const res = await request(app)
      .get('/api/datasources/lantmateriet/open/status')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.result.endpoint).toContain('mocked.example');
  });

  it('returns mocked SLU status', async () => {
    const res = await request(app)
      .get('/api/datasources/slu/status')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(Array.isArray(res.body.products)).toBe(true);
    expect(res.body.products[0].product).toBe('taxonomy');
  });

  it('uses mocked property lookup service', async () => {
    const res = await request(app)
      .post('/api/property/lookup')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        projectId,
        propertyDesignation: 'TEST 1:1',
        purpose: 'integration test',
      });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.result.designation).toBe('TEST 1:1');
  });

  it('GET /api/datasources/health returns health summary without auth', async () => {
    const res = await request(app).get('/api/datasources/health');

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(typeof res.body.connected).toBe('number');
    expect(typeof res.body.total).toBe('number');
    expect(typeof res.body.disconnected).toBe('number');
    expect(typeof res.body.errors).toBe('number');
    expect(typeof res.body.permitRequired).toBe('number');
    expect(typeof res.body.allOpenSourcesActive).toBe('boolean');
    expect(res.body.total).toBeGreaterThan(0);
    expect(res.body.connected + res.body.disconnected + res.body.errors).toBe(res.body.total);
    expect(typeof res.body.checkedAt).toBe('string');
  });
});
