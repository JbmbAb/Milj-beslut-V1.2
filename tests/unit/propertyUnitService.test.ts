import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  appendPropertyAudit: vi.fn(),
  assertPermission: vi.fn(),
  assertProjectMembership: vi.fn(),
  queryRaw: vi.fn(),
  validatePropertyLookupInput: vi.fn(),
  writePropertyAccessLog: vi.fn(),
}));

vi.mock('../../server/db/prisma', () => ({
  prisma: {
    $queryRaw: mocks.queryRaw,
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
  assertPermission: mocks.assertPermission,
  validatePropertyLookupInput: mocks.validatePropertyLookupInput,
}));

import {
  getPropertyLayer,
  lookupPropertyByDesignationFromPostgis,
} from '../../server/services/propertyUnitService';

describe('propertyUnitService', () => {
  const user = {
    id: 'user-1',
    organisationId: 'org-1',
    role: 'ADMIN' as const,
    bankidId: '191212121212',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertPermission.mockImplementation(() => undefined);
    mocks.assertProjectMembership.mockResolvedValue(undefined);
    mocks.validatePropertyLookupInput.mockImplementation(() => undefined);
    mocks.appendPropertyAudit.mockResolvedValue(undefined);
    mocks.writePropertyAccessLog.mockResolvedValue(undefined);
  });

  it('returns exact property hits and audits the lookup', async () => {
    mocks.queryRaw.mockResolvedValueOnce([
      {
        source_key: 'prop-1',
        designation: 'Orsa 1:1',
        municipality_code: '2034',
        municipality_name: 'Orsa',
        county_code: '20',
        source_dataset: 'core.property_unit',
        source_updated_at: new Date('2026-03-21T12:00:00.000Z'),
        raw_properties: {},
        geometry_geojson:
          '{"type":"Polygon","coordinates":[[[15.2,60.1],[15.3,60.1],[15.3,60.2],[15.2,60.1]]]}',
      },
    ]);

    const result = await lookupPropertyByDesignationFromPostgis(
      {
        projectId: 'project-1',
        propertyDesignation: 'Orsa 1:1',
        purpose: 'permit-review',
      },
      user,
    );

    expect(mocks.validatePropertyLookupInput).toHaveBeenCalledWith({
      projectId: 'project-1',
      propertyDesignation: 'Orsa 1:1',
      purpose: 'permit-review',
    });
    expect(mocks.assertPermission).toHaveBeenCalledWith(user, 'PROPERTY_LOOKUP');
    expect(mocks.assertProjectMembership).toHaveBeenCalledWith({
      projectId: 'project-1',
      userId: 'user-1',
      organisationId: 'org-1',
      role: 'ADMIN',
    });
    expect(result).toEqual({
      designation: 'Orsa 1:1',
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [15.2, 60.1],
            [15.3, 60.1],
            [15.3, 60.2],
            [15.2, 60.1],
          ],
        ],
      },
      boundaries: {
        type: 'Feature',
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [15.2, 60.1],
              [15.3, 60.1],
              [15.3, 60.2],
              [15.2, 60.1],
            ],
          ],
        },
        properties: {
          sourceKey: 'prop-1',
          municipalityCode: '2034',
          municipalityName: 'Orsa',
          countyCode: '20',
          sourceDataset: 'core.property_unit',
          sourceUpdatedAt: '2026-03-21T12:00:00.000Z',
          similarity: undefined,
        },
      },
      ownership: undefined,
      source: 'postgis',
      matchType: 'exact',
    });
    expect(mocks.appendPropertyAudit).toHaveBeenCalledWith({
      userId: 'user-1',
      projectId: 'project-1',
      propertyDesignation: 'Orsa 1:1',
      purpose: 'permit-review',
      responseClass: 'geometry',
    });
    expect(mocks.writePropertyAccessLog).toHaveBeenCalledWith({
      userId: 'user-1',
      projectId: 'project-1',
      propertyDesignation: 'Orsa 1:1',
      purpose: 'permit-review',
      responseClass: 'geometry',
    });
  });

  it('falls back to fuzzy property matches when exact hits are missing', async () => {
    mocks.queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        source_key: 'prop-2',
        designation: 'Orsa 1:2',
        municipality_code: '2034',
        municipality_name: 'Orsa',
        county_code: '20',
        source_dataset: 'core.property_unit',
        source_updated_at: '2026-03-20T12:00:00.000Z',
        raw_properties: {},
        geometry_geojson: '{"type":"Point","coordinates":[15.25,60.15]}',
        similarity: 0.91,
      },
    ]);

    const result = await lookupPropertyByDesignationFromPostgis(
      {
        projectId: 'project-1',
        propertyDesignation: 'Orsa 1 2',
        purpose: 'lookup',
      },
      user,
    );

    expect(result).toMatchObject({
      designation: 'Orsa 1:2',
      source: 'postgis',
      matchType: 'fuzzy',
    });
    expect(result.boundaries).toMatchObject({
      properties: {
        similarity: 0.91,
      },
    });
  });

  it('throws when no exact or fuzzy property matches exist', async () => {
    mocks.queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    await expect(
      lookupPropertyByDesignationFromPostgis(
        {
          projectId: 'project-1',
          propertyDesignation: 'Missing 1:1',
          purpose: 'lookup',
        },
        user,
      ),
    ).rejects.toThrow(/Fastighet hittades inte i PostGIS: Missing 1:1/);
  });

  it('builds geojson layers for property map views', async () => {
    mocks.queryRaw.mockResolvedValueOnce([
      {
        source_key: 'prop-3',
        designation: 'Orsa 2:1',
        geometry_geojson:
          '{"type":"Polygon","coordinates":[[[15.4,60.2],[15.5,60.2],[15.5,60.3],[15.4,60.2]]]}',
      },
    ]);

    const result = await getPropertyLayer({
      minLng: 15.2,
      minLat: 60.1,
      maxLng: 15.6,
      maxLat: 60.4,
    });

    expect(result).toEqual({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [15.4, 60.2],
                [15.5, 60.2],
                [15.5, 60.3],
                [15.4, 60.2],
              ],
            ],
          },
          properties: {
            sourceKey: 'prop-3',
            designation: 'Orsa 2:1',
          },
        },
      ],
    });
  });
});
