import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { prisma } from '../../../server/db/prisma';
import { SleipnerSpatialService } from '../../../server/modules/search/services/sleipnerSpatialService';

describe('🜄 Sleipner — Spatial & PostGIS Contracts (Paket 1)', () => {
  let spatialService: SleipnerSpatialService;

  beforeEach(() => {
    spatialService = new SleipnerSpatialService();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('ensureSpatialIndexes', () => {
    it('executes index creation raw SQL statement safely', async () => {
      const executeRawMock = vi.spyOn(prisma, '$executeRawUnsafe').mockResolvedValue(1);

      await spatialService.ensureSpatialIndexes();

      expect(executeRawMock).toHaveBeenCalledWith(expect.stringContaining('CREATE INDEX IF NOT EXISTS "environmental_cases_geom_idx"'));
    });
  });

  describe('upsertCaseGeometry', () => {
    it('fails-fast if the target case (Tier 1) does not exist in the database', async () => {
      vi.spyOn(prisma.environmentalCase, 'findUnique').mockResolvedValue(null); // Ärendet saknas!

      await expect(
        spatialService.upsertCaseGeometry('MPD-W-MISSING', 'POINT(456700 6764500)')
      ).rejects.toThrow('hittades inte i databasen');
    });

    it('determines and executes the correct ST_Transform and ST_GeomFromText query when target case exists', async () => {
      const mockCase = { id: 'case-db-id', caseId: 'MPD-W-2026-0812' };
      vi.spyOn(prisma.environmentalCase, 'findUnique').mockResolvedValue(mockCase as any);
      
      const executeRawMock = vi.spyOn(prisma, '$executeRawUnsafe').mockResolvedValue(1);

      const wkt = 'POLYGON((456000 6764000, 456000 6765000, 457000 6765000, 457000 6764000, 456000 6764000))';
      await spatialService.upsertCaseGeometry('MPD-W-2026-0812', wkt, 3006);

      expect(executeRawMock).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE "environmental_cases"'),
        wkt,
        3006,
        mockCase.id
      );
    });
  });

  describe('findCasesIntersectingProperty', () => {
    it('executes correct spatial intersection join and computes ratios', async () => {
      // Mocka PostGIS queryRawResultaterna
      const mockQueryRawResult = [
        {
          case_db_id: 'case-1',
          case_id: 'MPD-W-2026-0812',
          operator: 'Mora Bergtäkt AB',
          activity_code: '10.10',
          case_wkt: 'POLYGON(...)',
          overlap_area: 5000.0, // 5000 m2 överlapp
          property_area: 10000.0 // Fastighetens totalyta 10000 m2
        }
      ];

      const queryRawMock = vi.spyOn(prisma, '$queryRawUnsafe').mockResolvedValue(mockQueryRawResult as any);

      const searchWkt = 'POLYGON((456000 6764000, 456000 6765000, 457000 6765000, 457000 6764000, 456000 6764000))';
      const relations = await spatialService.findCasesIntersectingProperty(searchWkt, 3006);

      expect(queryRawMock).toHaveBeenCalledWith(
        expect.stringContaining('ST_Intersects'),
        searchWkt,
        3006
      );

      expect(relations.length).toBe(1);
      const rel = relations[0]!;
      expect(rel.case_id).toBe('MPD-W-2026-0812');
      expect(rel.intersection_area_m2).toBe(5000.0);
      expect(rel.intersection_ratio).toBe(0.5); // 5000 / 10000 = 0.5 ratio
      expect(rel.confidence).toBe(0.6); // ratio (0.5) + 0.1 = 0.6 confidence
    });
  });

  describe('findCasesWithinBbox', () => {
    it('converts rectangular boundaries to closed Polygon WKT and executes ST_Contains', async () => {
      const mockResult = [{ case_id: 'MPD-W-2026-0812' }];
      const queryRawMock = vi.spyOn(prisma, '$queryRawUnsafe').mockResolvedValue(mockResult as any);

      const cases = await spatialService.findCasesWithinBbox(456000, 6764000, 457000, 6765000, 3006);

      const expectedBboxPolygonWkt = 'POLYGON((456000 6764000, 456000 6765000, 457000 6765000, 457000 6764000, 456000 6764000))';
      expect(queryRawMock).toHaveBeenCalledWith(
        expect.stringContaining('ST_Contains'),
        expectedBboxPolygonWkt,
        3006
      );

      expect(cases).toEqual(['MPD-W-2026-0812']);
    });
  });
});
