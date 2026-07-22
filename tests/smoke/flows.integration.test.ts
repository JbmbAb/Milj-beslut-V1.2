import { prisma } from '../../server/db/prisma';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

import { createApp } from '../../server/createApp';


const app = createApp();

const hasDatabaseIntegration = process.env.DATABASE_INTEGRATION === 'true';

describe.skipIf(!hasDatabaseIntegration)('Critical Flows Smoke Test', () => {
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
      .send({ propertyDesignation: 'FLOW-TEST-1:1' });

    expect(
      createProjectRes.status,
      `Failed to create test project: ${JSON.stringify(createProjectRes.body)}`,
    ).toBe(200);
    projectId = createProjectRes.body?.project?.id;
    expect(projectId, 'projectId was not returned by API').toBeDefined();
  });

  afterAll(async () => {
    if (projectId) {
      await prisma.project.delete({ where: { id: projectId } }).catch(() => {});
    }
    await prisma.$disconnect();
  });

  it('Flow: Sewage Application Life-cycle (canonical API)', async () => {
    // 1. Create application via canonical route (legacy POST /api/sewage-applications → 410)
    const createRes = await request(app)
      .post('/api/sewage/applications')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        propertyDesignation: 'FLOW-TEST-1:1',
        latitude: 62.623,
        longitude: 14.623,
        applicantName: 'Smoke Testare',
        applicantEmail: 'smoke@test.invalid',
        systemType: 'MINIRENING',
        projectId,
      });
    expect(createRes.status, `Create failed: ${JSON.stringify(createRes.body)}`).toBe(201);
    const appId = createRes.body.application.id;

    // 2. Get status
    const statusRes = await request(app)
      .get(`/api/sewage/applications/${appId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(statusRes.status, `GET application status failed: ${JSON.stringify(statusRes.body)}`).toBe(200);
    expect(statusRes.body.application?.id).toBe(appId);

    // 3. Validate (submit kräver komplett payload – validering räcker som smoke)
    const validateRes = await request(app)
      .post(`/api/sewage/applications/${appId}/validate`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
    expect(validateRes.status, `Validate failed: ${JSON.stringify(validateRes.body)}`).not.toBe(500);
    expect(validateRes.status, `Validate failed: ${JSON.stringify(validateRes.body)}`).not.toBe(501);
    expect([200, 400, 422]).toContain(validateRes.status);
  }, 30000);

  it('Flow: Spatial Audit', async () => {
    const res = await request(app)
      .post('/api/spatial-audit')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        lat: 59.3293,
        lng: 18.0686,
      });
    expect(res.status).toBe(200);
    expect(res.body.text).toBeDefined();
  }, 30000);

  it('Flow: Document Search & RAG', async () => {
    const res = await request(app).post('/api/search/rag').set('Authorization', `Bearer ${adminToken}`).send({
      projectId,
      query: 'miljö',
      limit: 3,
    });
    expect(res.status, `RAG Search failed: ${JSON.stringify(res.body)}`).toBe(200);
    expect(res.body.ok).toBe(true);
  }, 30000);

  it('Flow: Admin Observability & Metrics', async () => {
    const metricsRes = await request(app)
      .get('/api/admin/observability/metrics')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(metricsRes.status).toBe(200);

    const statusRes = await request(app)
      .get('/api/admin/app-status')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(statusRes.status).toBe(200);
  }, 60000);
});
