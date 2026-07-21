import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  queryRawUnsafe: vi.fn(),
  txQueryRawUnsafe: vi.fn(),
  executeRawUnsafe: vi.fn(),
  transaction: vi.fn(),
  queryNmdRasterPoint: vi.fn(),
  loggerWarn: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock('../../server/db/prisma', () => ({
  prisma: {
    $queryRawUnsafe: mocks.queryRawUnsafe,
    $transaction: mocks.transaction,
  },
}));

vi.mock('../../server/logger', () => ({
  logger: {
    warn: mocks.loggerWarn,
    error: mocks.loggerError,
  },
}));

vi.mock('../../server/modules/gis/nmdRasterService', () => ({
  queryNmdRasterPoint: mocks.queryNmdRasterPoint,
}));

import { queryGeodataHandler } from '../../server/modules/ai/orchestrator/tools/queryGeodataTool';

describe('queryGeodataTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.queryRawUnsafe.mockResolvedValue([{ exists: true }]);
    mocks.executeRawUnsafe.mockResolvedValue(undefined);
    mocks.txQueryRawUnsafe.mockResolvedValue([]);
    mocks.queryNmdRasterPoint.mockResolvedValue(null);
    mocks.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        $executeRawUnsafe: mocks.executeRawUnsafe,
        $queryRawUnsafe: mocks.txQueryRawUnsafe,
      }),
    );
  });

  it('throws when coordinates are unreasonable', async () => {
    await expect(queryGeodataHandler({ latitude: 999, longitude: 18.06 })).rejects.toThrow(
      'Koordinaterna är ogiltiga.',
    );
  });

  it('returns an empty result payload when no allowed layers match', async () => {
    const result = await queryGeodataHandler({
      latitude: 59.3293,
      longitude: 18.0686,
      radiusMeters: 100,
    });

    expect(result).toEqual({
      message: 'Ingen geodata hittades inom 100 meter från angiven punkt.',
      location: { latitude: 59.3293, longitude: 18.0686 },
      radiusMeters: 100,
      layersChecked: [
        'nmd_2023',
        'protected_area',
        'natura2000_area',
        'sgu_soil_type_25k_100k',
        'sgu_fastmark_stabilitet',
        'sgu_permeability',
      ],
      results: [],
    });
    expect(mocks.executeRawUnsafe).toHaveBeenCalledWith(`SET LOCAL statement_timeout = '10s'`);
  });

  it('clamps the radius and returns structured hits with Swedish source labels', async () => {
    mocks.txQueryRawUnsafe
      .mockResolvedValueOnce([
        {
          id: 'nvr-1',
          source: 'Naturvårdsverket',
          layer: 'protected_area',
          type: 'Naturreservat',
          description: 'Södra skogen å, ä, ö',
          distanceMeters: 12.4,
        },
      ])
      .mockResolvedValue([]);

    const result = await queryGeodataHandler({
      latitude: 59.3293,
      longitude: 18.0686,
      radiusMeters: 99999,
    });

    expect(result).toMatchObject({
      location: { latitude: 59.3293, longitude: 18.0686 },
      radiusMeters: 5000,
      results: [
        {
          id: 'nvr-1',
          source: 'Naturvårdsverket',
          layer: 'protected_area',
          type: 'Naturreservat',
          description: 'Södra skogen å, ä, ö',
          distanceMeters: 12.4,
        },
      ],
    });
    expect(mocks.txQueryRawUnsafe).toHaveBeenCalledWith(expect.any(String), 18.0686, 59.3293, 5000);
  });

  it('includes NMD raster results for wooded coordinates when the out-of-db raster is available', async () => {
    mocks.queryNmdRasterPoint.mockResolvedValueOnce({
      code: 111,
      description: 'Tallskog på fastmark',
      mbKategori: 'skog',
      source: 'nmd2023_postgis',
      relation: 'env.nmd_2023',
    });

    const result = await queryGeodataHandler({
      latitude: 60.15,
      longitude: 15.25,
      radiusMeters: 50,
    });

    expect(result).toMatchObject({
      results: [
        {
          id: 'nmd-2023',
          source: 'Nationella marktäckedata',
          layer: 'nmd_2023',
          type: 'Markklass 111',
          description: 'Tallskog på fastmark',
          distanceMeters: 0,
        },
      ],
    });
  });
});
