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

// Import efter mock
import { prisma } from '../../server/db/prisma';
import { checkGeospatialRisks } from '../../server/services/geoService';

describe('geoService unit tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return a risk status when a coordinate has all geospatial intersecting features', async () => {
    vi.mocked(prisma.$queryRaw)
      .mockResolvedValueOnce([{ id: 1 }]) // landslide
      .mockResolvedValueOnce([{ external_id: 'N2K-123' }]) // natura 2000
      .mockResolvedValueOnce([{ nvr_id: 'PA-999' }]); // protected area
    vi.mocked(prisma.$queryRawUnsafe).mockResolvedValueOnce([{ layer_label: 'Postglacial lera (å, ä, ö)' }]); // ground layer

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

    const result = await checkGeospatialRisks(60.1, 15.2);
    expect(result.groundLayerLabel).toBe('Urberg, morän och lera');
  });

  it('should handle missing layer_label in results graciously', async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([]);
    vi.mocked(prisma.$queryRawUnsafe).mockResolvedValue([{}]);

    const result = await checkGeospatialRisks(59.1, 18.2);
    expect(result.groundLayerLabel).toBeNull();
  });

  it('should throw error if prisma query fails', async () => {
    vi.mocked(prisma.$queryRaw).mockRejectedValue(new Error('PostGIS connection timeout'));
    vi.mocked(prisma.$queryRawUnsafe).mockResolvedValue([]);

    await expect(checkGeospatialRisks(59.1, 18.2)).rejects.toThrow('PostGIS connection timeout');
  });
});
