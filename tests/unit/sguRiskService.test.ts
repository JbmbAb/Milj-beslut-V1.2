import { describe, it, expect, vi, beforeEach } from 'vitest';

// 1. Mocka Prisma HOISTED
const prismaMock = vi.hoisted(() => ({
  $queryRaw: vi.fn(),
}));

vi.mock('../../server/db/prisma', () => ({
  prisma: prismaMock,
}));

// 2. Import tjänst
import { auditSguRiskAtPoint, toGeologicalData } from '../../server/services/sguRiskService';

describe('sguRiskService Logic Coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should detect HIGH risk when a landslide feature is within 50 meters', async () => {
    prismaMock.$queryRaw
      .mockResolvedValueOnce([
        {
          source_key: 'g1',
          layer_label: 'Postglacial lera',
          source_scale: '1:50 000',
        },
      ])
      .mockResolvedValueOnce([
        {
          source_key: 'l1',
          feature_label: 'Skredärr',
          distance_meters: 45.2,
        },
      ]);

    const result = await auditSguRiskAtPoint(59.3, 18.0);
    expect(result.riskLevel).toBe('HIGH');
  });

  it('should correctly map SguRiskAudit to GeologicalData format', async () => {
    const mockAudit: any = {
      groundLayer: { hit: { layerLabel: 'Morän', sourceScale: '1:250 000' } },
      landslideFeatures: { hits: [{ featureCode: 101, featureLabel: 'Jordskred', distanceMeters: 10 }] },
      riskLevel: 'HIGH',
      manualReviewRequired: true,
      coverageMode: 'complete',
      summary: 'Test',
    };

    const mapped = toGeologicalData(mockAudit);
    expect(mapped.soilType).toBe('Morän');
  });

  it('should handle sample mode warnings', async () => {
    process.env.SGU_DB_COVERAGE_MODE = 'sample';
    prismaMock.$queryRaw.mockResolvedValue([]);
    const result = await auditSguRiskAtPoint(59.3, 18.0);
    expect(result.coverageMode).toBe('sample');
    expect(result.flags).toContain('sgu:sample-coverage');
  });
});
