import { describe, it, expect, vi, beforeEach } from 'vitest';

// 1. Mocka Prisma HOISTED (Viktigast)
vi.mock('../../server/db/prisma', () => ({
  prisma: {
    $queryRaw: vi.fn(),
  },
}));

// 2. Mocka beroenden för att slippa DB-strul
vi.mock('../../server/security/auditTrail', () => ({ appendPropertyAudit: vi.fn() }));
vi.mock('../../server/repositories/auditRepository', () => ({ writePropertyAccessLog: vi.fn() }));
vi.mock('../../server/repositories/projectAccessRepository', () => ({ assertProjectMembership: vi.fn() }));
vi.mock('../../server/security/projectAccess', () => ({
  validatePropertyLookupInput: vi.fn(),
  assertPermission: vi.fn(),
}));

// 3. Import efter alla mocks
import { prisma } from '../../server/db/prisma';
import {
  lookupPropertyByDesignationFromPostgis,
  getPropertyLayer,
} from '../../server/services/propertyUnitService';

describe('propertyUnitService (Final Robust Unit Test)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const testUser: any = { id: 'u1', organisationId: 'o1', role: 'ADMIN' };

  it('should map a PostGIS row to a structured GeoJSON payload', async () => {
    const mockRow = {
      source_key: 'key-123',
      designation: 'STORSPOVEN 1:2',
      municipality_name: 'Umeå',
      source_dataset: 'fastighetskarta',
      source_updated_at: new Date('2024-01-01'),
      geometry_geojson: JSON.stringify({ type: 'Point', coordinates: [20.0, 63.0] }),
    };

    const mockQuery = vi.mocked(prisma.$queryRaw);
    mockQuery.mockResolvedValueOnce([mockRow]);

    const result = await lookupPropertyByDesignationFromPostgis(
      {
        projectId: 'p1',
        propertyDesignation: 'STORSPOVEN 1:2',
        purpose: 'test',
      },
      testUser,
    );

    expect(result.designation).toBe('STORSPOVEN 1:2');
    expect(result.matchType).toBe('exact');
  });

  it('should handle fuzzy matches when exact match is missing', async () => {
    const mockQuery = vi.mocked(prisma.$queryRaw);
    mockQuery
      .mockResolvedValueOnce([]) // Exact empty
      .mockResolvedValueOnce([
        {
          // Fuzzy match
          designation: 'STORSPOVEN 1:2',
          geometry_geojson: '{}',
          similarity: 0.8,
        },
      ]);

    const result = await lookupPropertyByDesignationFromPostgis(
      {
        projectId: 'p1',
        propertyDesignation: 'storspoven',
        purpose: 'test',
      },
      testUser,
    );

    expect(result.matchType).toBe('fuzzy');
  });

  it('should build a valid FeatureCollection from BBOX results', async () => {
    const mockQuery = vi.mocked(prisma.$queryRaw);
    mockQuery.mockResolvedValueOnce([{ designation: 'A 1:1', geometry_geojson: '{"type":"Point"}' }]);

    const result = await getPropertyLayer({ minLng: 0, minLat: 0, maxLng: 1, maxLat: 1 });

    expect(result.type).toBe('FeatureCollection');
    expect(result.features.length).toBe(1);
  });

  it('should throw error if no match is found anywhere', async () => {
    const mockQuery = vi.mocked(prisma.$queryRaw);
    mockQuery.mockResolvedValue([]);

    await expect(
      lookupPropertyByDesignationFromPostgis(
        {
          projectId: 'p1',
          propertyDesignation: 'MISSING 1:1',
          purpose: 'test',
        },
        testUser,
      ),
    ).rejects.toThrow('Fastighet hittades inte');
  });

  it('should return empty FeatureCollection when no bbox results', async () => {
    const mockQuery = vi.mocked(prisma.$queryRaw);
    mockQuery.mockResolvedValue([]);

    const result = await getPropertyLayer({ minLng: 0, minLat: 0, maxLng: 1, maxLat: 1 });

    expect(result.type).toBe('FeatureCollection');
    expect(result.features).toHaveLength(0);
  });

  it('should handle rows with invalid geometry_geojson gracefully', async () => {
    const mockQuery = vi.mocked(prisma.$queryRaw);
    mockQuery.mockResolvedValueOnce([{ designation: 'A 1:1', geometry_geojson: 'not-json' }]);

    const result = await getPropertyLayer({ minLng: 0, minLat: 0, maxLng: 1, maxLat: 1 });

    expect(result.type).toBe('FeatureCollection');
    // Should not throw even with invalid JSON geometry
  });

  it('should handle DB error in getPropertyLayer', async () => {
    const mockQuery = vi.mocked(prisma.$queryRaw);
    mockQuery.mockRejectedValue(new Error('Query failed'));

    await expect(getPropertyLayer({ minLng: 0, minLat: 0, maxLng: 1, maxLat: 1 })).rejects.toThrow();
  });
});
