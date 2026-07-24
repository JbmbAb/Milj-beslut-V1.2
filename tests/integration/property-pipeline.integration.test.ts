/**
 * Stage 2: End-to-end property pipeline
 * lookup → spatial (±0.5 m) → prompt compilation
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';
import { prisma } from '../../server/db/prisma';
import { createApp } from '../../server/createApp';
import { compilePropertyPromptContext } from '../../server/modules/property/propertyPipelineContext';

const hasDatabaseIntegration = process.env.DATABASE_INTEGRATION === 'true';
const app = createApp();

type Fixture = {
  designation: string;
  property_wkt?: string;
  water_wkt?: string;
  expected_distance: number;
};

describe.skipIf(!hasDatabaseIntegration)('Property pipeline: lookup → spatial → prompt', () => {
  let adminToken = '';
  let projectId = '';
  let fixtures: Fixture[] = [];

  beforeAll(async () => {
    process.env.PROPERTY_LOOKUP_MODE = 'postgis';
    await prisma.$connect();

    const fixturesPath = path.join(__dirname, '../fixtures/spatial-regression-fixtures.json');
    fixtures = JSON.parse(fs.readFileSync(fixturesPath, 'utf8')) as Fixture[];

    // Seed a small subset for pipeline isolation (keeps runtime reasonable)
    const subset = fixtures.slice(0, 8);
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE core.property_unit CASCADE;`);
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE topo10.vatten CASCADE;`);
    await prisma.$executeRawUnsafe(
      `ALTER TABLE topo10.vatten ALTER COLUMN geom TYPE geometry(Geometry, 3006);`,
    );

    for (const [index, fixture] of subset.entries()) {
      if (fixture.property_wkt) {
        await prisma.$executeRawUnsafe(
          `INSERT INTO core.property_unit (designation, geom)
           VALUES ($1, ST_Multi(ST_GeomFromText($2, 3006)));`,
          fixture.designation,
          fixture.property_wkt,
        );
      }
      if (fixture.water_wkt) {
        await prisma.$executeRawUnsafe(
          `INSERT INTO topo10.vatten (objektidentitet, geom)
           VALUES ($1, ST_GeomFromText($2, 3006));`,
          `pipeline-water-${index}`,
          fixture.water_wkt,
        );
      }
    }
    fixtures = subset;

    const loginRes = await request(app)
      .post('/api/admin/auth/login')
      .send({
        username: process.env.ADMIN_CONSOLE_USERNAME || 'admin',
        password: process.env.ADMIN_CONSOLE_PASSWORD || 'admin',
      });
    expect(loginRes.status).toBe(200);
    adminToken = String(loginRes.body.accessToken || '');
    expect(adminToken.length).toBeGreaterThan(20);

    const createProjectRes = await request(app)
      .post('/api/admin/projects')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ propertyDesignation: fixtures[0]?.designation || 'TEST 1:1' });
    expect(createProjectRes.status).toBe(200);
    projectId = String(createProjectRes.body?.project?.id || '');
    expect(projectId).not.toBe('');
  }, 120_000);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('verifies lookup → spatial (±0.5 m) → prompt fields for reference properties', async () => {
    for (const ref of fixtures) {
      const lookupRes = await request(app)
        .post('/api/property/lookup')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          propertyDesignation: ref.designation,
          projectId,
          purpose: 'PIPELINE_REGRESSION',
        });

      expect(lookupRes.status).toBe(200);
      expect(lookupRes.body?.ok).toBe(true);
      const result = lookupRes.body?.result;
      expect(result?.designation).toBeTruthy();
      expect(result?.geometry).toBeTruthy();

      const ctx = await compilePropertyPromptContext(result);
      expect(ctx.promptFields.designation).toBeTruthy();
      expect(ctx.promptFields.hasGeometry).toBe(true);
      expect(ctx.promptText).toContain(ref.designation);
      expect(ctx.promptText.toLowerCase()).toContain('vatten');

      expect(ctx.distanceToWaterMeters).not.toBeNull();
      const difference = Math.abs(Number(ctx.distanceToWaterMeters) - ref.expected_distance);
      expect(difference).toBeLessThanOrEqual(0.5);
    }
  }, 180_000);
});
