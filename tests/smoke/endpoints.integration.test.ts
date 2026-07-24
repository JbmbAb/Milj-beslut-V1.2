import { prisma } from '../../server/db/prisma';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

import { createApp } from '../../server/createApp';

const app = createApp();

const hasDatabaseIntegration = process.env.DATABASE_INTEGRATION === 'true';

describe.skipIf(!hasDatabaseIntegration)('Blind Endpoint Smoke Test', () => {
  let adminToken = '';
  let projectId = '';

  beforeAll(async () => {
    await prisma.$connect();
    const loginRes = await request(app)
      .post('/api/admin/auth/login')
      .send({
        username: process.env.ADMIN_CONSOLE_USERNAME || 'admin',
        password: process.env.ADMIN_CONSOLE_PASSWORD || 'admin',
      });
    adminToken = loginRes.body.accessToken;

    const createProjectRes = await request(app)
      .post('/api/admin/projects')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ propertyDesignation: 'SMOKE-TEST' });
    projectId = createProjectRes.body?.project?.id;
  });

  afterAll(async () => {
    // Cleanup smoke test project
    if (projectId) {
      await prisma.project.delete({ where: { id: projectId } }).catch(() => {});
    }
    await prisma.$disconnect();
  });

  const endpoints = [
    'GET /health',
    'GET /ready',
    'GET /api/csrf-token',
    'GET /api/v1/projects',
    'GET /api/admin/requirements/cases',
    'GET /api/admin/requirements/rows',
    'GET /api/admin/requirements/citations',
    'GET /api/admin/requirements/reports/summary',
    'GET /api/admin/projects',
    'GET /api/projects/:projectId/plan',
    'GET /api/projects/:projectId/carbon',
    'GET /api/sewage-applications',
    'GET /api/admin/migration/readiness',
    'GET /api/admin/observability/metrics',
    'GET /api/layers/nvr',
    'GET /api/layers/water-protection',
    'GET /api/layers/natura2000',
    'GET /api/layers/international-protection',
    'GET /api/layers/sgu/grundlager',
    'GET /api/layers/hydro.lakes',
    'GET /api/layers/hydro.streams',
    'GET /api/layers/markcover',
    'GET /api/datasources/health',
    'GET /api/datasources/catalog',
    'GET /api/reference/map-layers',
    'GET /api/system/postgis',
    'GET /api/auth/bankid/status',
    'GET /api/app/bootstrap',
    'GET /api/reference/waste-codes',
    'GET /api/reference/templates',
    'GET /api/reference/receivers',
    'GET /api/reference/municipalities',
    'GET /api/audit/export',
    'GET /api/search/info',
    'GET /api/search/status',
    'GET /api/admin/app-status',
    'GET /api/admin/db-stats',
    'GET /api/admin/db-analysis',
    'GET /api/admin/db-contents',
    'GET /metrics',
    'GET /api/admin/errors/recent',
    'GET /api/admin/full-status',
    'GET /api/permits',
    'GET /api/receivers',
  ];

  endpoints.forEach((endpoint) => {
    const [method, path] = endpoint.split(' ');
    const testPath = path.replace(':projectId', projectId || 'fake-id');

    it(`${method} ${testPath}`, async () => {
      const req = (request(app) as any)[method.toLowerCase()](testPath);
      if (adminToken) req.set('Authorization', `Bearer ${adminToken}`);
      const res = await req.send();

      // Success criteria: not 500 (crash)
      // We allow 404 because some tests use 'fake-id' or 'mock' data which might not exist in a fresh DB.
      // The goal is to verify the endpoint is alive and the handler doesn't throw.
      expect(
        res.status,
        `Endpoint ${method} ${testPath} failed with status ${res.status}: ${JSON.stringify(res.body)}`,
      ).not.toBe(500);
      expect(
        res.status,
        `Endpoint ${method} ${testPath} failed with status ${res.status}: ${JSON.stringify(res.body)}`,
      ).not.toBe(501);

      // Optional: Log 404s for awareness but don't fail the build if it's a known resource-not-found
      if (res.status === 404) {
        // console.warn(`[Smoke] 404 for ${method} ${testPath}`);
      }
    });
  });
});
