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

vi.mock('../../src/platform/master', () => ({
  platform: {
    geo: {
      getProperty: vi.fn(async (data: { designation?: string }) => ({
        id: 'mock-property-id',
        designation: data.designation || 'TEST 1:1',
        municipality: 'STOCKHOLM',
        areaM2: 1500,
        ownerName: 'Mock Owner AB',
        centroid: { lat: 59.0, lng: 18.0 },
      })),
    },
  },
}));

vi.mock('../../server/services/sluService', () => ({
  getSluProductStatus: vi.fn(() => [{ product: 'taxonomy', configured: true }]),
  pingSluProduct: vi.fn(async () => ({ ok: true, status: 200 })),
  searchSluObservations: vi.fn(async () => ({ total: 0, rows: [] })),
  callSluProductApi: vi.fn(async () => ({ ok: true })),
}));

vi.mock('../../server/repositories/userRepository', () => ({
  ensureAdminConsoleUser: vi.fn(async () => ({
    id: 'mock-admin-id',
    bankidId: 'admin:admin',
    role: 'ADMIN',
    organisationId: 'mock-org-id',
  })),
  findAuthUserByBankId: vi.fn(async () => null),
}));

vi.mock('../../server/repositories/searchRepository', () => ({
  createOrGetAdminProject: vi.fn(async () => ({
    project: {
      id: 'mock-project-id',
      propertyDesignation: 'MOCK 1:1',
      status: 'ACTIVE',
      createdAt: new Date().toISOString(),
      organisation: { id: 'mock-org-id', name: 'Mock Org', orgNumber: '999999-0001' },
      _count: { documents: 0 },
    },
    created: true,
  })),
  enqueueSearchJob: vi.fn(async () => ({})),
  getSearchStatus: vi.fn(async () => ({})),
  listProjectsForAdmin: vi.fn(async () => ({ projects: [], total: 0 })),
  recoverStaleRunningJobs: vi.fn(async () => 0),
  requeueFailedJobs: vi.fn(async () => 0),
}));

vi.mock('../../server/repositories/projectAccessRepository', () => ({
  assertProjectMembership: vi.fn(async () => undefined),
}));

vi.mock('../../server/repositories/tokenRepository', () => ({
  isTokenRevoked: vi.fn(async () => false),
  markRefreshTokenAsUsed: vi.fn(async () => undefined),
  revokeRefreshToken: vi.fn(async () => undefined),
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
        password: process.env.ADMIN_CONSOLE_PASSWORD || 'admin',
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
        designation: 'TEST 1:1',
        projectId,
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
    expect(Array.isArray(res.body.notResponding)).toBe(true);
    for (const item of res.body.notResponding as Array<unknown>) {
      expect(item).toMatchObject({
        name: expect.any(String),
        provider: expect.any(String),
        status: expect.any(String),
        reason: expect.any(String),
      });
    }
  });
});
