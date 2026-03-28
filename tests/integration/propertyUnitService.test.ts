import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import dotenv from 'dotenv';

// SÃ¤kra DATABASE_URL
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

import { prisma } from '../../server/db/prisma';
import {
  lookupPropertyByDesignationFromPostgis,
  getPropertyLayer,
} from '../../server/services/propertyUnitService';

describe('propertyUnitService Integration (PostGIS)', () => {
  let testOrgId: string;
  let testProjectId: string;

  // Vi anvÃ¤nder any fÃ¶r att slippa import-strul i Vitest med Prisma-enums
  const testUser: any = {
    id: 'user-property-test',
    bankidId: 'bankid-property-test',
    organisationId: 'placeholder',
    role: 'ADMIN',
  };

  beforeAll(async () => {
    // 1. Skapa organisation fÃ¶rst (fÃ¶r Foreign Key i User)
    const org = await prisma.organisation.upsert({
      where: { orgNumber: 'PROP-TEST-ORG' },
      create: { name: 'Property Test Org', orgNumber: 'PROP-TEST-ORG' },
      update: {},
    });
    testOrgId = org.id;
    testUser.organisationId = testOrgId;

    // 2. Skapa den riktiga anvÃ¤ndaren kopplad till org
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

    // 3. Skapa projekt
    const project = await prisma.project.create({
      data: {
        organisationId: testOrgId,
        propertyDesignation: 'KÃ„LLAREN 1:1',
        status: 'ACTIVE',
      },
    });
    testProjectId = project.id;

    // 4. LÃ¤gg till anvÃ¤ndaren i projektet
    await prisma.projectMember.create({
      data: {
        projectId: testProjectId,
        userId: testUser.id,
        accessRole: 'OWNER',
      },
    });

    // 5. LÃ¤gg in en fastighet med GEOMETRI i core.property_unit
    try {
      await prisma.$executeRaw`
                INSERT INTO core.property_unit (
                    source_key, designation, designation_norm, 
                    municipality_name, source_dataset, geom
                ) VALUES (
                    'test-key-1', 
                    'KÃ„LLAREN 1:1', 
                    core.normalize_designation('KÃ„LLAREN 1:1'),
                    'Stockholm', 
                    'test-data',
                    ST_SetSRID(ST_GeomFromText('POLYGON((18.0 59.0, 18.1 59.0, 18.1 59.1, 18.0 59.1, 18.0 59.0))'), 4326)
                ) ON CONFLICT (source_key) DO UPDATE SET designation = EXCLUDED.designation;
            `;
    } catch (err) {
      console.error('FAILED TO SEED POSTGIS DATA:', err);
      throw err;
    }
  });

  afterAll(async () => {
    // StÃ¤dning i rÃ¤tt ordning fÃ¶r referenser
    await prisma.projectMember.deleteMany({ where: { projectId: testProjectId } });
    await prisma.propertyAccessLog.deleteMany({ where: { projectId: testProjectId } });
    await prisma.project.deleteMany({ where: { organisationId: testOrgId } });
    await prisma.user.deleteMany({ where: { id: testUser.id } });
    await prisma.organisation.delete({ where: { id: testOrgId } });
    await prisma.$executeRaw`DELETE FROM core.property_unit WHERE source_key = 'test-key-1'`;
  });

  it('should find property with exact match and return GeoJSON', async () => {
    const input = {
      projectId: testProjectId,
      propertyDesignation: 'KÃ„LLAREN 1:1',
      purpose: 'Testing exact lookup',
    };

    const result = await lookupPropertyByDesignationFromPostgis(input, testUser);

    expect(result.designation).toBe('KÃ„LLAREN 1:1');
    expect(result.geometry).toBeDefined();
    expect((result.geometry as any).type).toBe('Polygon');
    expect(result.matchType).toBe('exact');
  });

  it('should find property with fuzzy match', async () => {
    const input = {
      projectId: testProjectId,
      propertyDesignation: 'kallaren 1 1',
      purpose: 'Testing fuzzy lookup',
    };

    const result = await lookupPropertyByDesignationFromPostgis(input, testUser);

    expect(result.designation).toBe('KÃ„LLAREN 1:1');
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
