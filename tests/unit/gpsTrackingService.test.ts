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

import { addGpsPosition, getGpsTrack } from '../../legacy/experimental/gpsTrackingService';

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

  it('returns zero distance for empty GPS track', async () => {
    mocks.getGpsTrack.mockResolvedValue([]);

    const track = await getGpsTrack('booking-empty');
    expect(track.bookingId).toBe('booking-empty');
    expect(track.positions).toHaveLength(0);
    expect(track.totalDistance).toBe(0);
  });

  it('links first GPS position with null prevHash when no prior position exists', async () => {
    mocks.getLatestPosition.mockResolvedValue(null);
    mocks.addGpsPosition.mockResolvedValue({
      id: 'gps-first',
      bookingId: 'booking-new',
      lat: 57.7,
      lng: 12.0,
      timestamp: new Date('2026-02-01T10:00:00.000Z'),
      hash: 'first-hash',
      prevHash: null,
    });

    const position = await addGpsPosition({
      bookingId: 'booking-new',
      projectId: 'project-2',
      lat: 57.7,
      lng: 12.0,
      actingUserId: 'user-1',
    });

    expect(position.prevHash).toBeNull();
    expect(mocks.addGpsPosition).toHaveBeenCalledWith(expect.objectContaining({ prevHash: null }));
  });
});
