import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  addGpsPosition: vi.fn(),
  getGpsTrack: vi.fn(),
  getLatestPosition: vi.fn(),
  clearGpsTrack: vi.fn(),
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../server/repositories/gpsRepository', () => ({
  addGpsPosition: mocks.addGpsPosition,
  getGpsTrack: mocks.getGpsTrack,
  getLatestPosition: mocks.getLatestPosition,
  clearGpsTrack: mocks.clearGpsTrack,
}));

vi.mock('../../server/security/auditTrail', () => ({
  appendDomainAudit: vi.fn(),
}));

vi.mock('../../server/logger', () => ({
  logger: mocks.logger,
}));

import {
  addGpsPosition,
  clearGpsTrack,
  getGpsTrack,
  getLatestPosition,
} from '../../server/services/gpsTrackingService';

describe('gpsTrackingService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('validates coordinates before storing positions', async () => {
    await expect(
      addGpsPosition({
        bookingId: 'booking-1',
        projectId: 'project-1',
        lat: 95,
        lng: 18,
        actingUserId: 'user-1',
      }),
    ).rejects.toThrow(/lat/i);

    await expect(
      addGpsPosition({
        bookingId: 'booking-1',
        projectId: 'project-1',
        lat: 59,
        lng: 190,
        actingUserId: 'user-1',
      }),
    ).rejects.toThrow(/lng/i);
  });

  it('stores chain-linked gps positions and returns iso timestamps', async () => {
    mocks.getLatestPosition.mockResolvedValue({
      id: 'gps-prev',
      bookingId: 'booking-1',
      lat: 59.3,
      lng: 18.0,
      timestamp: new Date('2026-01-01T09:00:00.000Z'),
      hash: 'prev-hash',
      prevHash: null,
    });
    mocks.addGpsPosition.mockResolvedValue({
      id: 'gps-1',
      bookingId: 'booking-1',
      lat: 59.31,
      lng: 18.01,
      altitude: 10,
      speedKmh: 50,
      heading: 180,
      accuracy: 5,
      timestamp: new Date('2026-01-01T09:05:00.000Z'),
      hash: 'new-hash',
      prevHash: 'prev-hash',
    });

    const position = await addGpsPosition({
      bookingId: 'booking-1',
      projectId: 'project-1',
      lat: 59.31,
      lng: 18.01,
      altitude: 10,
      speedKmh: 50,
      heading: 180,
      accuracy: 5,
      actingUserId: 'user-1',
    });

    expect(position.timestamp).toBe('2026-01-01T09:05:00.000Z');
    expect(position.prevHash).toBe('prev-hash');
    expect(mocks.addGpsPosition).toHaveBeenCalledWith(
      expect.objectContaining({
        bookingId: 'booking-1',
        prevHash: 'prev-hash',
        hash: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expect(mocks.logger.debug).toHaveBeenCalled();
  });

  it('computes approximate travel distance from stored track points', async () => {
    mocks.getGpsTrack.mockResolvedValue([
      {
        id: 'gps-1',
        bookingId: 'booking-1',
        lat: 59.3293,
        lng: 18.0686,
        timestamp: new Date('2026-01-01T09:00:00.000Z'),
        hash: 'h1',
        prevHash: null,
      },
      {
        id: 'gps-2',
        bookingId: 'booking-1',
        lat: 59.332,
        lng: 18.07,
        timestamp: new Date('2026-01-01T09:05:00.000Z'),
        hash: 'h2',
        prevHash: 'h1',
      },
      {
        id: 'gps-3',
        bookingId: 'booking-1',
        lat: 59.335,
        lng: 18.073,
        timestamp: new Date('2026-01-01T09:10:00.000Z'),
        hash: 'h3',
        prevHash: 'h2',
      },
    ]);

    const track = await getGpsTrack('booking-1');

    expect(track.bookingId).toBe('booking-1');
    expect(track.positions).toHaveLength(3);
    expect(track.totalDistance).toBeGreaterThan(0);
  });

  it('returns latest positions and clears tracks', async () => {
    mocks.getLatestPosition.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: 'gps-latest',
      bookingId: 'booking-1',
      lat: 59.33,
      lng: 18.07,
      timestamp: new Date('2026-01-01T09:10:00.000Z'),
      hash: 'h-latest',
      prevHash: 'h2',
    });

    expect(await getLatestPosition('booking-1')).toBeNull();

    const latest = await getLatestPosition('booking-1');
    expect(latest?.timestamp).toBe('2026-01-01T09:10:00.000Z');

    await clearGpsTrack('booking-1');
    expect(mocks.clearGpsTrack).toHaveBeenCalledWith('booking-1');
  });
});
