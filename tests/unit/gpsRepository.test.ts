import { beforeEach, describe, expect, it, vi } from 'vitest';

const prisma = vi.hoisted(() => ({
  gpsPosition: {
    create: vi.fn(),
    findMany: vi.fn(),
    findFirst: vi.fn(),
    deleteMany: vi.fn(),
  },
}));

vi.mock('../../server/db/prisma', () => ({ prisma }));

import {
  addGpsPosition,
  clearGpsTrack,
  getGpsTrack,
  getLatestPosition,
} from '../../server/repositories/gpsRepository';

describe('gpsRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates gps positions with an injected timestamp', async () => {
    prisma.gpsPosition.create.mockResolvedValue({ id: 'gps-1' });

    const result = await addGpsPosition({
      bookingId: 'booking-1',
      lat: 59.33,
      lng: 18.06,
      altitude: 15,
      speedKmh: 40,
      heading: 90,
      accuracy: 5,
      hash: 'hash-1',
      prevHash: null,
    });

    expect(result).toEqual({ id: 'gps-1' });
    expect(prisma.gpsPosition.create).toHaveBeenCalledWith({
      data: {
        bookingId: 'booking-1',
        lat: 59.33,
        lng: 18.06,
        altitude: 15,
        speedKmh: 40,
        heading: 90,
        accuracy: 5,
        hash: 'hash-1',
        prevHash: null,
        timestamp: expect.any(Date),
      },
    });
  });

  it('lists gps track points in ascending timestamp order', async () => {
    prisma.gpsPosition.findMany.mockResolvedValue([{ id: 'gps-2' }]);

    await expect(getGpsTrack('booking-2')).resolves.toEqual([{ id: 'gps-2' }]);
    expect(prisma.gpsPosition.findMany).toHaveBeenCalledWith({
      where: { bookingId: 'booking-2' },
      orderBy: { timestamp: 'asc' },
    });
  });

  it('loads the latest gps position in descending timestamp order', async () => {
    prisma.gpsPosition.findFirst.mockResolvedValue({ id: 'gps-latest' });

    await expect(getLatestPosition('booking-3')).resolves.toEqual({ id: 'gps-latest' });
    expect(prisma.gpsPosition.findFirst).toHaveBeenCalledWith({
      where: { bookingId: 'booking-3' },
      orderBy: { timestamp: 'desc' },
    });
  });

  it('clears gps track rows for a booking', async () => {
    prisma.gpsPosition.deleteMany.mockResolvedValue({ count: 3 });

    await expect(clearGpsTrack('booking-4')).resolves.toEqual({ count: 3 });
    expect(prisma.gpsPosition.deleteMany).toHaveBeenCalledWith({
      where: { bookingId: 'booking-4' },
    });
  });
});
