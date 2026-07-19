import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  queryRawUnsafe: vi.fn(),
}));

vi.mock('../../db.server', () => ({
  prisma: {
    $queryRawUnsafe: mocks.queryRawUnsafe,
  },
}));


describe('app analysis notificationService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns sensitive-area summary when layers intersect', async () => {
    const { screenCNotification } = await import('../../app/services/analysis/notificationService');
    mocks.queryRawUnsafe.mockResolvedValue([{ layer: 'Natura 2000' }, { layer: 'Naturreservat' }]);

    const geometry = {
      type: 'Polygon',
      coordinates: [[[18, 59], [18.1, 59], [18.1, 59.1], [18, 59.1], [18, 59]]],
    };

    const result = await screenCNotification(geometry);

    expect(mocks.queryRawUnsafe).toHaveBeenCalledWith(expect.any(String), JSON.stringify(geometry));
    expect(result).toEqual({
      isSensitiveArea: true,
      intersectingLayers: ['Natura 2000', 'Naturreservat'],
      permitRequired: true,
      riskSummary:
        'Verksamheten krockar med Natura 2000, Naturreservat. Miljökonsekvensbeskrivning kan krävas.',
    });
  });

  it('returns non-blocking summary when no layers intersect', async () => {
    const { screenCNotification } = await import('../../app/services/analysis/notificationService');
    mocks.queryRawUnsafe.mockResolvedValue([]);

    const result = await screenCNotification({ type: 'Point', coordinates: [18.1, 59.3] });

    expect(result).toEqual({
      isSensitiveArea: false,
      intersectingLayers: [],
      permitRequired: false,
      riskSummary: 'Inga omedelbara spatiala hinder identifierade.',
    });
  });
});
