import { describe, it, expect, vi, beforeEach } from 'vitest';

// Denna mock måste vara helt självständig
vi.mock('../../server/db/prisma', () => {
  return {
    prisma: {
      $queryRaw: vi.fn(),
    },
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
    const mockQuery = vi.mocked(prisma.$queryRaw);
    mockQuery
      .mockResolvedValueOnce([{ id: 1 }]) // landslide
      .mockResolvedValueOnce([{ layer_label: 'Postglacial lera (å, ä, ö)' }]) // ground layer
      .mockResolvedValueOnce([{ external_id: 'N2K-123' }]) // natura 2000
      .mockResolvedValueOnce([{ nvr_id: 'PA-999' }]); // protected area

    const result = await checkGeospatialRisks(59.3293, 18.0686);

    expect(result).toEqual({
      hasLandslideRisk: true,
      groundLayerLabel: 'Postglacial lera (å, ä, ö)',
      isInNatura2000: true,
      isProtectedArea: true,
    });
    expect(mockQuery).toHaveBeenCalledTimes(4);
  });

  it('should handle cases where no risks are found (empty arrays from DB)', async () => {
    const mockQuery = vi.mocked(prisma.$queryRaw);
    mockQuery.mockResolvedValue([]);

    const result = await checkGeospatialRisks(59.1, 18.2);

    expect(result).toEqual({
      hasLandslideRisk: false,
      groundLayerLabel: null,
      isInNatura2000: false,
      isProtectedArea: false,
    });
  });

  it('should handle Swedish characters in labels correctly from the mock', async () => {
    const mockQuery = vi.mocked(prisma.$queryRaw);
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ layer_label: 'Urberg, morän och lera' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const result = await checkGeospatialRisks(60.1, 15.2);
    expect(result.groundLayerLabel).toBe('Urberg, morän och lera');
  });

  it('should handle missing layer_label in results graciously', async () => {
    const mockQuery = vi.mocked(prisma.$queryRaw);
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{}])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const result = await checkGeospatialRisks(59.1, 18.2);
    expect(result.groundLayerLabel).toBeNull();
  });

  it('should throw error if prisma query fails', async () => {
    const mockQuery = vi.mocked(prisma.$queryRaw);
    mockQuery.mockRejectedValue(new Error('PostGIS connection timeout'));

    await expect(checkGeospatialRisks(59.1, 18.2)).rejects.toThrow('PostGIS connection timeout');
  });
});
