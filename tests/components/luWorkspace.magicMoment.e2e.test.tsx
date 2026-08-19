/**
 * LuWorkspace E2E — real PostGIS property lookup + GenerateLocalizationReport.
 * HTTP transport is replaced with production functions (no SpatialProvider/CAS stubs).
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Client } from 'pg';
import { config } from 'dotenv';
import { LuWorkspace } from '../../components/app/lu/LuWorkspace';

config({ path: '.env.test' });

const DB_URL =
  process.env.TEST_DATABASE_URL ||
  process.env.DATABASE_URL ||
  'postgresql://riskguard:password@127.0.0.1:5432/riskguard_test?sslmode=disable';

process.env.DATABASE_URL = DB_URL;
process.env.TEST_DATABASE_URL = DB_URL;
process.env.LOCALIZATION_STRICT_SOURCES = 'false';
process.env.PROPERTY_LOOKUP_MODE = 'postgis';

const DESIGNATION = 'VÄSTERÅS 1:1';
const SOURCE_KEY = 'e2e-ui-magic-moment-vasteras-1-1';
const EASTING = 591234;
const NORTHING = 6612345;
const PROJECT_ID = 'proj-e2e-ui-lu-magic';

vi.mock('../../components/CesiumMapView', () => ({
  default: () => <div data-testid="cesium-map-view" />,
}));

vi.mock('@miljobeslut/mps-identity', () => ({
  designTokens: {
    colors: {
      surfaceDarkStone: { hex: '#1C1C1E' },
      coreTurquoise: { hex: '#40E0D0' },
      flowLightCyan: { hex: '#E0FFFF' },
      coreGraphite: { hex: '#2C2C2E' },
      statusAudit: { hex: '#F0E68C' },
    },
  },
}));

const testUser = {
  id: 'user-e2e-ui-lu-magic',
  bankidId: 'bankid-e2e-ui-lu-magic',
  organisationId: 'placeholder',
  role: 'ADMIN' as const,
};

vi.mock('../../src/ui/api-client/geo.client', async () => {
  const actual = await vi.importActual<typeof import('../../src/ui/api-client/geo.client')>(
    '../../src/ui/api-client/geo.client',
  );
  return {
    ...actual,
    fetchPropertyInfo: async (designation: string) => {
      const { lookupPropertyByDesignationFromPostgis } = await import(
        '../../server/services/propertyUnitService'
      );
      const raw = await lookupPropertyByDesignationFromPostgis(
        {
          projectId: PROJECT_ID,
          propertyDesignation: designation,
          purpose: 'E2E_UI_LU_MAGIC',
        },
        testUser,
      );
      return actual.mapLookupResultToPropertyInfo(raw as Record<string, unknown>);
    },
  };
});

vi.mock('../../services/coreApiClient', async () => {
  return {
    getActiveProjectId: () => PROJECT_ID,
    callApi: async (path: string, opts?: { method?: string; body?: unknown }) => {
      if (path !== '/api/localization/generate-report') {
        throw new Error(`Unexpected API path in E2E: ${path}`);
      }
      const { generateLocalizationReport } = await import(
        '../../server/services/localizationReportService'
      );
      const body = (opts?.body ?? {}) as {
        projectId: string;
        siteAlternatives: Array<{ id: string; name?: string; lat: number; lng: number }>;
      };
      const report = await generateLocalizationReport({
        projectId: body.projectId,
        siteAlternatives: body.siteAlternatives,
        userId: testUser.id,
        user: testUser,
      });
      return { ok: true, ...report };
    },
  };
});

describe('LuWorkspace E2E Magic Moment (real PostGIS)', () => {
  let testOrgId = '';

  beforeAll(async () => {
    const { prisma } = await import('../../server/db/prisma');

    const client = new Client({ connectionString: DB_URL });
    await client.connect();
    await client.query('DELETE FROM env.sgu_well WHERE id >= 999920 AND id < 999930');
    await client.query(
      'DELETE FROM env.ebh_potentiellt_fororenade_omraden WHERE fid >= 999920 AND fid < 999930',
    );
    await client.query("DELETE FROM env.protected_area WHERE nvr_id = 'NVR-E2E-UI-MAGIC'");
    await client.query('DELETE FROM core.property_unit WHERE source_key = $1', [SOURCE_KEY]);

    await client.query(
      `
      INSERT INTO core.property_unit (
        source_key, designation, designation_norm,
        municipality_name, source_dataset, geom
      ) VALUES (
        $1, $2, core.normalize_designation($2),
        'Västerås', 'e2e-ui-magic-moment',
        ST_Multi(ST_Buffer(ST_SetSRID(ST_MakePoint($3, $4), 3006), 25))
      )
      `,
      [SOURCE_KEY, DESIGNATION, EASTING, NORTHING],
    );
    await client.query(
      `INSERT INTO env.sgu_well (id, geom) VALUES (999920, ST_SetSRID(ST_MakePoint($1, $2), 3006))`,
      [EASTING, NORTHING],
    );
    await client.query(
      `INSERT INTO env.ebh_potentiellt_fororenade_omraden (fid, geom)
       VALUES (999920, ST_Multi(ST_SetSRID(ST_MakePoint($1, $2), 3006)))`,
      [EASTING, NORTHING],
    );
    await client.query(
      `INSERT INTO env.protected_area (nvr_id, name, protection_type, geom)
       VALUES (
         'NVR-E2E-UI-MAGIC', 'E2E UI Magic Protected', 'Naturreservat',
         ST_Multi(ST_Buffer(ST_SetSRID(ST_MakePoint($1, $2), 3006), 10))
       )`,
      [EASTING, NORTHING],
    );
    await client.end();

    const org = await prisma.organisation.upsert({
      where: { orgNumber: 'E2E-UI-LU-MAGIC-ORG' },
      create: { name: 'E2E UI LU Magic Org', orgNumber: 'E2E-UI-LU-MAGIC-ORG', role: 'CLIENT' },
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

    await prisma.project.deleteMany({ where: { id: PROJECT_ID } }).catch(() => undefined);
    await prisma.project.create({
      data: {
        id: PROJECT_ID,
        organisationId: testOrgId,
        propertyDesignation: DESIGNATION,
        status: 'ACTIVE',
      },
    });
    await prisma.projectMember.create({
      data: {
        projectId: PROJECT_ID,
        userId: testUser.id,
        accessRole: 'OWNER',
      },
    });
  }, 60_000);

  afterAll(async () => {
    const { prisma } = await import('../../server/db/prisma');
    const client = new Client({ connectionString: DB_URL });
    await client.connect();
    await client.query('DELETE FROM env.sgu_well WHERE id >= 999920 AND id < 999930');
    await client.query(
      'DELETE FROM env.ebh_potentiellt_fororenade_omraden WHERE fid >= 999920 AND fid < 999930',
    );
    await client.query("DELETE FROM env.protected_area WHERE nvr_id = 'NVR-E2E-UI-MAGIC'");
    await client.query('DELETE FROM core.property_unit WHERE source_key = $1', [SOURCE_KEY]);
    await client.end();

    await prisma.projectMember.deleteMany({ where: { projectId: PROJECT_ID } });
    await prisma.propertyAccessLog.deleteMany({ where: { projectId: PROJECT_ID } }).catch(() => undefined);
    await prisma.project.deleteMany({ where: { id: PROJECT_ID } });
    await prisma.user.deleteMany({ where: { id: testUser.id } });
    if (testOrgId) {
      await prisma.organisation.delete({ where: { id: testOrgId } }).catch(() => undefined);
    }
    await prisma.$disconnect().catch(() => undefined);
  }, 60_000);

  it('renders assessment from real PostGIS Magic Moment chain', async () => {
    const user = userEvent.setup();
    render(<LuWorkspace />);

    await user.type(screen.getByTestId('lu-designation'), DESIGNATION);
    await user.click(screen.getByTestId('lu-lookup'));
    expect(await screen.findByTestId('lu-site-ready', {}, { timeout: 30_000 })).toBeInTheDocument();

    await user.click(screen.getByTestId('lu-run'));
    expect(await screen.findByTestId('lu-results', {}, { timeout: 120_000 })).toBeInTheDocument();
    expect(screen.getByTestId('lu-assessment-id')).toHaveTextContent(/^Assessment: assessment-/);
    expect(screen.getByTestId('lu-property-context-id')).toHaveTextContent(
      /Property context: prop-/,
    );
    expect(screen.getByTestId('lu-risk')).not.toHaveTextContent('—');
    expect(screen.getByTestId('lu-motor-meta')).toHaveTextContent(/admitted/);
  }, 180_000);
});
