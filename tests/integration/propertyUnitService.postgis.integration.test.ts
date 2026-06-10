import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../server/db/prisma';
import {
  lookupPropertyByDesignationFromPostgis,
  getPropertyLayer,
} from '../../server/services/propertyUnitService';
import { seedPropertyUnit, GAVLE_BRYNAS_BBOX } from '../helpers/postgisSeed';
import { describeIfDatabaseIntegration } from './integrationTestEnv';

describeIfDatabaseIntegration('propertyUnitService PostGIS integration', () => {
  let testOrgId = '';
  let testProjectId = '';

  const testUser = {
    id: 'user-postgis-property',
    bankidId: 'bankid-postgis-property',
    organisationId: 'placeholder',
    role: 'ADMIN' as const,
  };

  beforeAll(async () => {
    const org = await prisma.organisation.upsert({
      where: { orgNumber: 'POSTGIS-PROP-ORG' },
      create: { name: 'PostGIS Property Org', orgNumber: 'POSTGIS-PROP-ORG' },
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

    await seedPropertyUnit(prisma, {
      designation: 'KALLAREN 1:1',
      sourceKey: 'integration-kallaren-1-1',
      municipalityName: 'Stockholm',
    });
  });

  afterAll(async () => {
    if (testProjectId) {
      await prisma.projectMember.deleteMany({ where: { projectId: testProjectId } });
      await prisma.propertyAccessLog.deleteMany({ where: { projectId: testProjectId } });
      await prisma.project.deleteMany({ where: { id: testProjectId } });
    }
    await prisma.user.deleteMany({ where: { id: testUser.id } });
    if (testOrgId) {
      await prisma.organisation.delete({ where: { id: testOrgId } }).catch(() => undefined);
    }
    await prisma.$executeRaw`DELETE FROM core.property_unit WHERE source_key = 'integration-kallaren-1-1'`;
  });

  it('finds property by designation in core.property_unit', async () => {
    const hit = await lookupPropertyByDesignationFromPostgis(
      {
        projectId: testProjectId,
        propertyDesignation: 'KALLAREN 1:1',
        purpose: 'PostGIS integration lookup',
      },
      testUser,
    );
    expect(hit.designation).toContain('KALLAREN');
    expect(hit.geometry).toBeDefined();
  });

  it('returns property layer features for seeded bbox', async () => {
    const layer = await getPropertyLayer(GAVLE_BRYNAS_BBOX);
    expect(layer.type).toBe('FeatureCollection');
    expect(Array.isArray(layer.features)).toBe(true);
  });
});
