import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Prisma mock ───────────────────────────────────────────────────────────────

const gpsPositionMock = vi.hoisted(() => ({
  create: vi.fn(),
  findMany: vi.fn(),
  findFirst: vi.fn(),
  deleteMany: vi.fn(),
}));

vi.mock('../../server/db/prisma', () => ({
  prisma: {
    gpsPosition: gpsPositionMock,
  },
}));

// ─── Module under test ─────────────────────────────────────────────────────────

import {
  addGpsPosition,
  clearGpsTrack,
  getGpsTrack,
  getLatestPosition,
} from '../../server/repositories/gpsRepository';

// ─── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

describe('gpsRepository', () => {
  // ── addGpsPosition ────────────────────────────────────────────────────────

  describe('addGpsPosition', () => {
    it('generates a timestamp and calls prisma.gpsPosition.create with all fields', async () => {
      const data = {
        bookingId: 'booking-1',
        lat: 59.33,
        lng: 18.07,
        altitude: 10,
        speedKmh: 60,
        heading: 180,
        accuracy: 5,
        hash: 'abc123',
        prevHash: null,
      };

      const created = { id: 'pos-1', ...data, timestamp: new Date() };
      gpsPositionMock.create.mockResolvedValue(created);

      const result = await addGpsPosition(data);

      expect(gpsPositionMock.create).toHaveBeenCalledTimes(1);
      const call = gpsPositionMock.create.mock.calls[0][0];
      expect(call.data.bookingId).toBe(data.bookingId);
      expect(call.data.lat).toBe(data.lat);
      expect(call.data.hash).toBe(data.hash);
      expect(call.data.timestamp).toBeInstanceOf(Date);
      expect(result).toBe(created);
    });

    it('works with only required fields', async () => {
      const data = { bookingId: 'b-2', lat: 0, lng: 0, hash: 'h' };
      gpsPositionMock.create.mockResolvedValue({ id: 'pos-2' });

      await addGpsPosition(data);

      expect(gpsPositionMock.create).toHaveBeenCalledTimes(1);
    });
  });

  // ── getGpsTrack ───────────────────────────────────────────────────────────

  describe('getGpsTrack', () => {
    it('calls findMany with bookingId filter and ascending timestamp order', async () => {
      gpsPositionMock.findMany.mockResolvedValue([]);

      await getGpsTrack('booking-track-1');

      expect(gpsPositionMock.findMany).toHaveBeenCalledWith({
        where: { bookingId: 'booking-track-1' },
        orderBy: { timestamp: 'asc' },
      });
    });

    it('returns the array from prisma', async () => {
      const positions = [{ id: 'p1' }, { id: 'p2' }];
      gpsPositionMock.findMany.mockResolvedValue(positions);

      const result = await getGpsTrack('bk-2');
      expect(result).toEqual(positions);
    });
  });

  // ── getLatestPosition ─────────────────────────────────────────────────────

  describe('getLatestPosition', () => {
    it('calls findFirst with bookingId filter and descending timestamp order', async () => {
      gpsPositionMock.findFirst.mockResolvedValue(null);

      await getLatestPosition('booking-latest');

      expect(gpsPositionMock.findFirst).toHaveBeenCalledWith({
        where: { bookingId: 'booking-latest' },
        orderBy: { timestamp: 'desc' },
      });
    });

    it('returns null when no positions exist', async () => {
      gpsPositionMock.findFirst.mockResolvedValue(null);
      const result = await getLatestPosition('bk-none');
      expect(result).toBeNull();
    });

    it('returns the latest position object', async () => {
      const pos = { id: 'p-latest', lat: 57.7, lng: 11.9 };
      gpsPositionMock.findFirst.mockResolvedValue(pos);

      const result = await getLatestPosition('bk-has');
      expect(result).toEqual(pos);
    });
  });

  // ── clearGpsTrack ─────────────────────────────────────────────────────────

  describe('clearGpsTrack', () => {
    it('calls deleteMany with the correct bookingId', async () => {
      gpsPositionMock.deleteMany.mockResolvedValue({ count: 3 });

      await clearGpsTrack('booking-del');

      expect(gpsPositionMock.deleteMany).toHaveBeenCalledWith({
        where: { bookingId: 'booking-del' },
      });
    });

    it('returns the deleteMany result', async () => {
      gpsPositionMock.deleteMany.mockResolvedValue({ count: 5 });
      const result = await clearGpsTrack('bk-del-2');
      expect(result).toEqual({ count: 5 });
    });
  });
});
