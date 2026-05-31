import { it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../../server/db/prisma';
import {
  lookupPropertyByDesignationFromPostgis,
  getPropertyLayer,
} from '../../server/services/propertyUnitService';
import { describeIfDatabaseIntegration } from './integrationTestEnv';

describeIfDatabaseIntegration('propertyUnitService Integration (PostGIS)', () => {
  let testOrgId = '';
  let testProjectId = '';

  const testUser: any = {
    id: 'user-property-test',
    bankidId: 'bankid-property-test',
    organisationId: 'placeholder',
    role: 'ADMIN',
  };

  beforeAll(async () => {
    const org = await prisma.organisation.upsert({
      where: { orgNumber: 'PROP-TEST-ORG' },
      create: { name: 'Property Test Org', orgNumber: 'PROP-TEST-ORG' },
      update: {},
    });
    testOrgId = org.id;
    testUser.organisationId = testOrgId;

    await prisma.user.upsert({
      where: { bankidId: testUser.bankidId },
      create: {
        id: testUser.id,
        bankidId: testUser.bankidId,
        organisationId: testOrgId,
        role: 'ADMIN',
      },
      update: { organisationId: testOrgId },
    });

    const project = await prisma.project.create({
      data: {
        organisationId: testOrgId,
        propertyDesignation: 'KALLAREN 1:1',
        status: 'ACTIVE',
      },
    });
    testProjectId = project.id;

    await prisma.projectMember.create({
      data: {
        projectId: testProjectId,
        userId: testUser.id,
        accessRole: 'OWNER',
      },
    });

    try {
      await prisma.$executeRaw`
        INSERT INTO core.property_unit (
          source_key, designation, designation_norm,
          municipality_name, source_dataset, geom
        ) VALUES (
          'test-key-1',
          'KALLAREN 1:1',
          core.normalize_designation('KALLAREN 1:1'),
          'Stockholm',
          'test-data',
          ST_Multi(ST_Transform(
            ST_SetSRID(ST_GeomFromText('POLYGON((18.0 59.0, 18.1 59.0, 18.1 59.1, 18.0 59.1, 18.0 59.0))'), 4326),
            3006
          ))
        ) ON CONFLICT (source_key) DO UPDATE SET
          designation = EXCLUDED.designation,
          designation_norm = EXCLUDED.designation_norm,
          municipality_name = EXCLUDED.municipality_name,
          source_dataset = EXCLUDED.source_dataset,
          geom = EXCLUDED.geom;
      `;
    } catch (error) {
      console.error('FAILED TO SEED POSTGIS DATA:', error);
      throw error;
    }
  });

  afterAll(async () => {
    if (testProjectId) {
      await prisma.projectMember.deleteMany({ where: { projectId: testProjectId } });
      await prisma.propertyAccessLog.deleteMany({ where: { projectId: testProjectId } });
      await prisma.project.deleteMany({ where: { id: testProjectId } });
    }
    await prisma.user.deleteMany({ where: { id: testUser.id } });
    if (testOrgId) {
      await prisma.organisation.delete({ where: { id: testOrgId } });
    }
    await prisma.$executeRaw`DELETE FROM core.property_unit WHERE source_key = 'test-key-1'`;
  });

  it('should find property with exact match and return GeoJSON', async () => {
    const input = {
      projectId: testProjectId,
      propertyDesignation: 'KALLAREN 1:1',
      purpose: 'Testing exact lookup',
    };

    const result = await lookupPropertyByDesignationFromPostgis(input, testUser);

    expect(result.designation).toBe('KALLAREN 1:1');
    expect(result.geometry).toBeDefined();
    expect((result.geometry as any).type).toBe('MultiPolygon');
    expect(result.matchType).toBe('exact');
  });

  it('should find property with fuzzy match when exact normalization differs', async () => {
    // This input normalizes differently than 'KALLAREN 1:1' -> 'KALLAREN 1 1'
    // Actually, 'kallaren 1 1' normalizes to 'KALLAREN 1 1' which is EXACT match.
    // To test fuzzy, we need something that is close but not exact after normalization.
    const input = {
      projectId: testProjectId,
      propertyDesignation: 'kallaren 1 2', // Close to 1:1
      purpose: 'Testing fuzzy lookup',
    };

    const result = await lookupPropertyByDesignationFromPostgis(input, testUser);

    expect(result.designation).toBe('KALLAREN 1:1');
    expect(result.matchType).toBe('fuzzy');
  });

  it('should return features within a BBOX', async () => {
    const bbox = {
      minLng: 17.9,
      minLat: 58.9,
      maxLng: 18.2,
      maxLat: 59.2,
    };

    const layer = await getPropertyLayer(bbox);

    expect(layer.type).toBe('FeatureCollection');
    expect(layer.features.length).toBeGreaterThan(0);
  });
});
