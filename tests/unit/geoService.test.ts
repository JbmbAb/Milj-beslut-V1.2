import { describe, it, expect, vi, beforeEach } from 'vitest';

// Denna mock måste vara helt självständig
vi.mock('../../server/db/prisma', () => {
  const mockPrisma = {
    $queryRaw: vi.fn(),
    $queryRawUnsafe: vi.fn(),
  };
  return {
    prisma: mockPrisma,
  };
});

vi.mock('../../server/services/hybridGeoService', () => ({
  tryFetchLocalProtectionData: vi.fn(),
}));

// Import efter mock
import { prisma } from '../../server/db/prisma';
import { tryFetchLocalProtectionData } from '../../server/services/hybridGeoService';
import { checkGeospatialRisks } from '../../server/services/geoService';

describe('geoService unit tests', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should return a risk status when a coordinate has all geospatial intersecting features', async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([{ id: 1 }]); // landslide
    vi.mocked(prisma.$queryRawUnsafe).mockResolvedValueOnce([{ layer_label: 'Postglacial lera (å, ä, ö)' }]); // ground layer
    vi.mocked(tryFetchLocalProtectionData).mockResolvedValueOnce([
      { source: 'natura2000' },
      { source: 'nvr' },
    ] as any);

    const result = await checkGeospatialRisks(59.3293, 18.0686);

    expect(result).toEqual({
      hasLandslideRisk: true,
      groundLayerLabel: 'Postglacial lera (å, ä, ö)',
      isInNatura2000: true,
      isProtectedArea: true,
    });
  });

  it('should handle cases where no risks are found (empty arrays from DB)', async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([]);
    vi.mocked(prisma.$queryRawUnsafe).mockResolvedValue([]);
    vi.mocked(tryFetchLocalProtectionData).mockResolvedValue([] as any);

    const result = await checkGeospatialRisks(59.1, 18.2);

    expect(result).toEqual({
      hasLandslideRisk: false,
      groundLayerLabel: null,
      isInNatura2000: false,
      isProtectedArea: false,
    });
  });

  it('should handle Swedish characters in labels correctly from the mock', async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([]);
    vi.mocked(prisma.$queryRawUnsafe).mockResolvedValue([{ layer_label: 'Urberg, morän och lera' }]);
    vi.mocked(tryFetchLocalProtectionData).mockResolvedValue([] as any);

    const result = await checkGeospatialRisks(60.1, 15.2);
    expect(result.groundLayerLabel).toBe('Urberg, morän och lera');
  });

  it('should handle missing layer_label in results graciously', async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([]);
    vi.mocked(prisma.$queryRawUnsafe).mockResolvedValue([{}]);
    vi.mocked(tryFetchLocalProtectionData).mockResolvedValue([] as any);

    const result = await checkGeospatialRisks(59.1, 18.2);
    expect(result.groundLayerLabel).toBeNull();
  });

  it('should throw error if prisma query fails', async () => {
    vi.mocked(prisma.$queryRaw).mockRejectedValue(new Error('PostGIS connection timeout'));
    vi.mocked(prisma.$queryRawUnsafe).mockResolvedValue([]);

    await expect(checkGeospatialRisks(59.1, 18.2)).rejects.toThrow('PostGIS connection timeout');
  });
});
