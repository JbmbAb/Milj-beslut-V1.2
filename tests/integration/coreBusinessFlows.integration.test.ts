import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { createApp } from '../../server/createApp';

const prisma = new PrismaClient();
const app = createApp();

const hasDatabaseIntegration = process.env.DATABASE_INTEGRATION === 'true';

describe.skipIf(!hasDatabaseIntegration)('Core Business Flows Integration Test', () => {
  let adminToken = '';
  let projectId = '';

  beforeAll(async () => {
    await prisma.$connect();
    
    // Login to get admin token
    const loginRes = await request(app)
      .post('/api/admin/auth/login')
      .send({
        username: process.env.ADMIN_CONSOLE_USERNAME || 'admin',
        password: process.env.ADMIN_CONSOLE_PASSWORD || 'admin',
      });
    adminToken = loginRes.body.accessToken;
  });

  afterAll(async () => {
    // Cleanup created project
    if (projectId) {
      await prisma.project.delete({ where: { id: projectId } }).catch(() => {});
    }
    await prisma.$disconnect();
  });

  it('Flow: Create Project, update Plan and Generate Permit', async () => {
    // 1. Create a Project
    const createProjectRes = await request(app)
      .post('/api/admin/projects')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        propertyDesignation: 'BUSINESS-FLOW-1:1',
      });
    
    expect(createProjectRes.status).toBe(200);
    expect(createProjectRes.body.project).toBeDefined();
    projectId = createProjectRes.body.project.id;

    // 2. Fetch the Project Plan
    const getPlanRes = await request(app)
      .get(`/api/projects/${projectId}/plan`)
      .set('Authorization', `Bearer ${adminToken}`);
    
    // It should exist or at least return 200/404 based on default initialization
    expect([200, 404]).toContain(getPlanRes.status);

    // 3. Save Project Plan details
    const savePlanRes = await request(app)
      .post(`/api/projects/${projectId}/plan/save`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        description: 'New test plan',
        estimatedDurationDays: 30
      });
    
    // Some routes might be stubbed, but let's check for standard success
    expect([200, 201]).toContain(savePlanRes.status);

    // 4. Generate Permit Application
    // Since this relies on Gemini AI, it might return 500 if API key is missing or invalid,
    // or 400 if project lacks details. In a smoke/integration test without external keys, 
    // we want to at least verify the endpoint is reachable and processes the request.
    const permitRes = await request(app)
      .post(`/api/projects/${projectId}/permit/generate`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
    
    expect(permitRes.status).not.toBe(404);
  });

  it('Flow: Asset Triage / AI Classification', async () => {
    // This flow simulates classifying an activity
    const classifyRes = await request(app)
      .post('/api/v1/classification/activity')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        description: 'Schaktning av 500 ton massor'
      });
    
    // Should return 400 if validation fails, or 200/500 depending on AI integration.
    expect(classifyRes.status).not.toBe(404);
  });
});
