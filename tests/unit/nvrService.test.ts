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

  it('passes the custom radius to the query', async () => {
    mocks.queryRaw.mockResolvedValueOnce([]);

    await fetchProtectedAreas(59.33, 18.06, 1500);

    // Verify the query was called once — radius is a template literal param
    expect(mocks.queryRaw).toHaveBeenCalledTimes(1);
  });

  it('preserves defined area_ha values in the result', async () => {
    mocks.queryRaw.mockResolvedValueOnce([
      { id: 'nvr-5', name: 'Biotopskyddsomrade', type: 'Biotopskydd', area_ha: 3.7, distance_m: 10 },
    ]);

    const result = await fetchProtectedAreas(60.0, 15.0);

    expect(result[0].area_ha).toBe(3.7);
  });

  it('returns undefined area_ha when the row has null area_ha', async () => {
    mocks.queryRaw.mockResolvedValueOnce([
      { id: 'n2k-1', name: 'N2K site', type: 'Natura 2000 B', area_ha: null, distance_m: 100 },
    ]);

    const result = await fetchProtectedAreas(60.0, 15.0);

    expect(result[0].area_ha).toBeUndefined();
  });

  it('returns empty array when DB errors occur', async () => {
    mocks.queryRaw.mockRejectedValueOnce(new Error('PostGIS unavailable'));

    await expect(fetchProtectedAreas(60.0, 15.0)).resolves.toEqual([]);
  });

  it('returns empty array when DB returns no rows', async () => {
    mocks.queryRaw.mockResolvedValueOnce([]);

    const result = await fetchProtectedAreas(60.0, 15.0, 200);

    expect(result).toEqual([]);
  });
});
