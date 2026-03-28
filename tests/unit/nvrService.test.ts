import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  queryRaw: vi.fn(),
}));

vi.mock('../../server/db/prisma', () => ({
  prisma: {
    $queryRaw: mocks.queryRaw,
  },
}));

import { fetchProtectedAreas } from '../../server/services/nvrService';

describe('nvrService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('maps protected-area rows and normalises empty values', async () => {
    mocks.queryRaw.mockResolvedValueOnce([
      {
        id: 'nvr-1',
        name: 'Naturreservat A',
        type: 'Naturreservat',
        area_ha: 14.2,
        distance_m: 25,
      },
      {
        id: 'natura-2',
        name: null,
        type: null,
        area_ha: null,
        distance_m: 40,
      },
    ]);

    const result = await fetchProtectedAreas(60.14, 15.2, 750);

    expect(result).toEqual([
      {
        id: 'nvr-1',
        name: 'Naturreservat A',
        type: 'Naturreservat',
        area_ha: 14.2,
      },
      {
        id: 'natura-2',
        name: 'Namnlost omrade',
        type: 'Skyddat omrade',
      },
    ]);
    expect(mocks.queryRaw).toHaveBeenCalledTimes(1);
  });

  it('uses the default radius when none is provided', async () => {
    mocks.queryRaw.mockResolvedValueOnce([]);

    await expect(fetchProtectedAreas(59.33, 18.06)).resolves.toEqual([]);
    expect(mocks.queryRaw).toHaveBeenCalledTimes(1);
  });
});
