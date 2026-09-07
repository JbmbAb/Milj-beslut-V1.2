import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  executeRaw: vi.fn(),
  documentRecordCreate: vi.fn(),
  documentContentCreate: vi.fn(),
  appendPropertyAudit: vi.fn(),
  writePropertyAccessLog: vi.fn(),
  assertProjectMembership: vi.fn(),
  validatePropertyLookupInput: vi.fn(),
  assertPermission: vi.fn(),
}));

vi.mock('../../server/db/prisma', () => ({
  prisma: {
    $queryRaw: mocks.queryRaw,
    $executeRaw: mocks.executeRaw,
    documentRecord: {
      create: mocks.documentRecordCreate,
    },
    documentContent: {
      create: mocks.documentContentCreate,
    },
  },
}));

vi.mock('../../server/security/auditTrail', () => ({
  appendPropertyAudit: mocks.appendPropertyAudit,
}));

vi.mock('../../server/repositories/auditRepository', () => ({
  writePropertyAccessLog: mocks.writePropertyAccessLog,
}));

vi.mock('../../server/repositories/projectAccessRepository', () => ({
  assertProjectMembership: mocks.assertProjectMembership,
}));

vi.mock('../../server/security/projectAccess', () => ({
  validatePropertyLookupInput: mocks.validatePropertyLookupInput,
  assertPermission: mocks.assertPermission,
}));

import { lookupPropertyByDesignationFromPostgis } from '../../server/services/propertyUnitService';
import type { AuthUser } from '../../server/security/types';

const user: AuthUser = {
  id: 'user-1',
  organisationId: 'org-1',
  bankidId: 'bankid-1',
  role: 'CONSULTANT',
};

const input = {
  projectId: 'project-1',
  propertyDesignation: 'NACKA ORMINGE 7:8',
  purpose: 'site assessment',
};

describe('C-P1-04 — property lookup fallback authority enforcement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertProjectMembership.mockResolvedValue(undefined);
    mocks.executeRaw.mockResolvedValue(1);
    mocks.documentRecordCreate.mockResolvedValue({});
    mocks.documentContentCreate.mockResolvedValue({});
    mocks.appendPropertyAudit.mockResolvedValue(undefined);
    mocks.writePropertyAccessLog.mockResolvedValue(undefined);
  });

  it('fails closed on PostGIS miss without materializing authority-bearing fallback state', async () => {
    mocks.queryRaw.mockResolvedValue([]);

    await expect(lookupPropertyByDesignationFromPostgis(input, user)).rejects.toThrow(
      'Fastighet hittades inte i PostGIS',
    );

    expect(mocks.executeRaw).not.toHaveBeenCalled();
    expect(mocks.documentRecordCreate).not.toHaveBeenCalled();
    expect(mocks.documentContentCreate).not.toHaveBeenCalled();
    expect(mocks.appendPropertyAudit).not.toHaveBeenCalled();
    expect(mocks.writePropertyAccessLog).not.toHaveBeenCalled();
  });

  it('continues to serve exact PostGIS matches as read-model lookup results', async () => {
    mocks.queryRaw.mockResolvedValueOnce([
      {
        source_key: 'lm-1',
        designation: 'NACKA ORMINGE 7:8',
        municipality_code: '0182',
        municipality_name: 'Nacka',
        county_code: '01',
        source_dataset: 'fastighetskarta',
        source_updated_at: new Date('2026-01-01T00:00:00Z'),
        raw_properties: {},
        geometry_geojson: '{"type":"Point","coordinates":[18.2912,59.3146]}',
        centroid_easting: 672000,
        centroid_northing: 6580000,
      },
    ]);

    const result = await lookupPropertyByDesignationFromPostgis(input, user);

    expect(result).toMatchObject({
      designation: 'NACKA ORMINGE 7:8',
      source: 'postgis',
      matchType: 'exact',
      boundaries: {
        properties: {
          centroidSweref99Tm: [672000, 6580000],
        },
      },
    });
    expect(mocks.executeRaw).not.toHaveBeenCalled();
    expect(mocks.documentRecordCreate).not.toHaveBeenCalled();
    expect(mocks.documentContentCreate).not.toHaveBeenCalled();
    expect(mocks.appendPropertyAudit).toHaveBeenCalledTimes(1);
    expect(mocks.writePropertyAccessLog).toHaveBeenCalledTimes(1);
  });

  it('does not fabricate a centroid when canonical geometry has none', async () => {
    mocks.queryRaw.mockResolvedValueOnce([
      {
        source_key: 'lm-empty',
        designation: 'NACKA ORMINGE 7:9',
        municipality_code: '0182',
        municipality_name: 'Nacka',
        county_code: '01',
        source_dataset: 'fastighetskarta',
        source_updated_at: new Date('2026-01-01T00:00:00Z'),
        raw_properties: {},
        geometry_geojson: '{"type":"MultiPolygon","coordinates":[]}',
        centroid_easting: null,
        centroid_northing: null,
      },
    ]);

    const result = await lookupPropertyByDesignationFromPostgis(input, user);

    expect((result as { boundaries: { properties: Record<string, unknown> } }).boundaries.properties).not.toHaveProperty(
      'centroidSweref99Tm',
    );
  });
});
