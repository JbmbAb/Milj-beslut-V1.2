import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  gpsPositionCreate: vi.fn(),
  gpsPositionFindMany: vi.fn(),
  gpsPositionFindFirst: vi.fn(),
  gpsPositionDeleteMany: vi.fn(),
}));

vi.mock('../../server/db/prisma', () => ({
  prisma: {
    gpsPosition: {
      create: mocks.gpsPositionCreate,
      findMany: mocks.gpsPositionFindMany,
      findFirst: mocks.gpsPositionFindFirst,
      deleteMany: mocks.gpsPositionDeleteMany,
    },
  },
}));

import {
  addGpsPosition,
  clearGpsTrack,
  getGpsTrack,
  getLatestPosition,
} from '../../server/repositories/gpsRepository';

beforeEach(() => {
  vi.resetAllMocks();
});

describe('addGpsPosition', () => {
  it('creates a gps position with a timestamp and returns the created record', async () => {
    const created = { id: 'gps-1', bookingId: 'booking-42', lat: 59.33, lng: 18.06 };
    mocks.gpsPositionCreate.mockResolvedValue(created);

    const input = {
      bookingId: 'booking-42',
      lat: 59.33,
      lng: 18.06,
      hash: 'h1',
    };

    const result = await addGpsPosition(input);

    expect(mocks.gpsPositionCreate).toHaveBeenCalledOnce();
    const callArg = mocks.gpsPositionCreate.mock.calls[0][0];
    expect(callArg.data.bookingId).toBe('booking-42');
    expect(callArg.data.lat).toBe(59.33);
    expect(callArg.data.lng).toBe(18.06);
    expect(callArg.data.hash).toBe('h1');
    expect(callArg.data.timestamp).toBeInstanceOf(Date);
    expect(result).toEqual(created);
  });

  it('passes optional fields when provided', async () => {
    mocks.gpsPositionCreate.mockResolvedValue({});

    await addGpsPosition({
      bookingId: 'b-1',
      lat: 55.0,
      lng: 13.0,
      altitude: 42,
      speedKmh: 30,
      heading: 180,
      accuracy: 5,
      hash: 'h2',
      prevHash: 'h1',
    });

    const callArg = mocks.gpsPositionCreate.mock.calls[0][0];
    expect(callArg.data.altitude).toBe(42);
    expect(callArg.data.speedKmh).toBe(30);
    expect(callArg.data.heading).toBe(180);
    expect(callArg.data.accuracy).toBe(5);
    expect(callArg.data.prevHash).toBe('h1');
  });
});

describe('getGpsTrack', () => {
  it('returns positions for the booking ordered by timestamp asc', async () => {
    const positions = [
      { id: 'p1', bookingId: 'b-10', timestamp: new Date('2026-01-01T10:00:00Z') },
      { id: 'p2', bookingId: 'b-10', timestamp: new Date('2026-01-01T10:05:00Z') },
    ];
    mocks.gpsPositionFindMany.mockResolvedValue(positions);

    const result = await getGpsTrack('b-10');

    expect(mocks.gpsPositionFindMany).toHaveBeenCalledWith({
      where: { bookingId: 'b-10' },
      orderBy: { timestamp: 'asc' },
    });
    expect(result).toEqual(positions);
  });

  it('returns an empty array when no positions exist', async () => {
    mocks.gpsPositionFindMany.mockResolvedValue([]);

    const result = await getGpsTrack('b-unknown');

    expect(result).toEqual([]);
  });
});

describe('getLatestPosition', () => {
  it('returns the most recent position for the booking', async () => {
    const latest = { id: 'p-last', bookingId: 'b-5', timestamp: new Date('2026-03-15') };
    mocks.gpsPositionFindFirst.mockResolvedValue(latest);

    const result = await getLatestPosition('b-5');

    expect(mocks.gpsPositionFindFirst).toHaveBeenCalledWith({
      where: { bookingId: 'b-5' },
      orderBy: { timestamp: 'desc' },
    });
    expect(result).toEqual(latest);
  });

  it('returns null when no position exists for the booking', async () => {
    mocks.gpsPositionFindFirst.mockResolvedValue(null);

    const result = await getLatestPosition('b-empty');

    expect(result).toBeNull();
  });
});

describe('clearGpsTrack', () => {
  it('deletes all positions for the booking and returns the count result', async () => {
    mocks.gpsPositionDeleteMany.mockResolvedValue({ count: 3 });

    const result = await clearGpsTrack('b-99');

    expect(mocks.gpsPositionDeleteMany).toHaveBeenCalledWith({
      where: { bookingId: 'b-99' },
    });
    expect(result).toEqual({ count: 3 });
  });

  it('returns count 0 when there are no positions to delete', async () => {
    mocks.gpsPositionDeleteMany.mockResolvedValue({ count: 0 });

    const result = await clearGpsTrack('b-empty');

    expect(result).toEqual({ count: 0 });
  });
});

describe('gpsRepository - Error Handling & Edge Cases', () => {
  describe('addGpsPosition (error handling)', () => {
    it('propagates database errors during creation', async () => {
      mocks.gpsPositionCreate.mockRejectedValue(new Error('database constraint'));

      await expect(
        addGpsPosition({
          bookingId: 'b-fail',
          lat: 59.33,
          lng: 18.06,
          hash: 'h-fail',
        }),
      ).rejects.toThrow('database constraint');
    });

    it('handles extreme coordinate values', async () => {
      mocks.gpsPositionCreate.mockResolvedValue({
        id: 'gps-extreme',
        bookingId: 'b-extreme',
        lat: 90.0,
        lng: 180.0,
      });

      await addGpsPosition({
        bookingId: 'b-extreme',
        lat: 90.0,
        lng: 180.0,
        hash: 'h-extreme',
      });

      expect(mocks.gpsPositionCreate).toHaveBeenCalled();
    });

    it('handles negative coordinates', async () => {
      mocks.gpsPositionCreate.mockResolvedValue({
        id: 'gps-neg',
        bookingId: 'b-neg',
        lat: -45.5,
        lng: -120.3,
      });

      await addGpsPosition({
        bookingId: 'b-neg',
        lat: -45.5,
        lng: -120.3,
        hash: 'h-neg',
      });

      expect(mocks.gpsPositionCreate).toHaveBeenCalled();
    });

    it('handles very high altitude and speed values', async () => {
      mocks.gpsPositionCreate.mockResolvedValue({});

      await addGpsPosition({
        bookingId: 'b-high',
        lat: 60.0,
        lng: 15.0,
        altitude: 10000,
        speedKmh: 1000,
        hash: 'h-high',
      });

      const callArg = mocks.gpsPositionCreate.mock.calls[0][0];
      expect(callArg.data.altitude).toBe(10000);
      expect(callArg.data.speedKmh).toBe(1000);
    });

    it('handles zero and negative speed values', async () => {
      mocks.gpsPositionCreate.mockResolvedValue({});

      await addGpsPosition({
        bookingId: 'b-zero',
        lat: 60.0,
        lng: 15.0,
        speedKmh: 0,
        hash: 'h-zero',
      });

      expect(mocks.gpsPositionCreate).toHaveBeenCalled();
    });

    it('handles 360-degree heading values', async () => {
      mocks.gpsPositionCreate.mockResolvedValue({});

      await addGpsPosition({
        bookingId: 'b-heading',
        lat: 60.0,
        lng: 15.0,
        heading: 360,
        hash: 'h-heading',
      });

      const callArg = mocks.gpsPositionCreate.mock.calls[0][0];
      expect(callArg.data.heading).toBe(360);
    });

    it('handles very high accuracy values', async () => {
      mocks.gpsPositionCreate.mockResolvedValue({});

      await addGpsPosition({
        bookingId: 'b-acc',
        lat: 60.0,
        lng: 15.0,
        accuracy: 50000,
        hash: 'h-acc',
      });

      const callArg = mocks.gpsPositionCreate.mock.calls[0][0];
      expect(callArg.data.accuracy).toBe(50000);
    });
  });

  describe('getGpsTrack (error handling)', () => {
    it('propagates database errors', async () => {
      mocks.gpsPositionFindMany.mockRejectedValue(new Error('query timeout'));

      await expect(getGpsTrack('b-timeout')).rejects.toThrow('query timeout');
    });

    it('handles empty string booking id', async () => {
      mocks.gpsPositionFindMany.mockResolvedValue([]);

      const result = await getGpsTrack('');

      expect(result).toEqual([]);
    });

    it('handles very large tracks', async () => {
      const largeTrack = Array.from({ length: 10000 }, (_, i) => ({
        id: `p-${i}`,
        bookingId: 'b-large',
        timestamp: new Date(Date.now() + i * 1000),
      }));
      mocks.gpsPositionFindMany.mockResolvedValue(largeTrack);

      const result = await getGpsTrack('b-large');

      expect(result).toHaveLength(10000);
    });
  });

  describe('getLatestPosition (error handling)', () => {
    it('propagates database errors', async () => {
      mocks.gpsPositionFindFirst.mockRejectedValue(new Error('db error'));

      await expect(getLatestPosition('b-error')).rejects.toThrow('db error');
    });

    it('handles special characters in booking id', async () => {
      mocks.gpsPositionFindFirst.mockResolvedValue(null);

      const result = await getLatestPosition('b-special!@#$%');

      expect(result).toBeNull();
    });
  });

  describe('clearGpsTrack (error handling)', () => {
    it('propagates database errors', async () => {
      mocks.gpsPositionDeleteMany.mockRejectedValue(new Error('delete failed'));

      await expect(clearGpsTrack('b-delete-fail')).rejects.toThrow('delete failed');
    });

    it('handles special characters in booking id', async () => {
      mocks.gpsPositionDeleteMany.mockResolvedValue({ count: 0 });

      const result = await clearGpsTrack('b-special!@#');

      expect(result).toEqual({ count: 0 });
    });

    it('handles very large deletion results', async () => {
      mocks.gpsPositionDeleteMany.mockResolvedValue({ count: 100000 });

      const result = await clearGpsTrack('b-large-delete');

      expect(result).toEqual({ count: 100000 });
    });
  });
});
