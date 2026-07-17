import { beforeEach, describe, expect, it, vi } from 'vitest';

const prisma = vi.hoisted(() => ({
  transportBooking: {
    create: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  driverJournal: {
    create: vi.fn(),
    update: vi.fn(),
    findMany: vi.fn(),
  },
  limsReport: {
    create: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
    findMany: vi.fn(),
  },
  gpsPosition: {
    create: vi.fn(),
    findMany: vi.fn(),
    findFirst: vi.fn(),
    deleteMany: vi.fn(),
  },
}));

vi.mock('../../server/db/prisma', () => ({ prisma }));

import {
  createDriverJournal,
  createTransportBooking,
  getTransportBooking,
  listJournalsForBooking,
  updateDriverJournal,
  updateTransportBookingStatus,
} from '../../server/repositories/transportRepository';
import {
  createLimsReport,
  getLimsReport,
  listLimsReportsByBooking,
  listLimsReportsBySample,
  verifyLimsReport,
} from '../../server/repositories/limsRepository';
import {
  addGpsPosition,
  clearGpsTrack,
  getGpsTrack,
  getLatestPosition,
} from '../../server/repositories/gpsRepository';

describe('logistics repositories', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('forwards transport booking create and lookup calls to prisma', async () => {
    prisma.transportBooking.create.mockResolvedValue({ id: 'booking-1' });
    prisma.transportBooking.findUnique.mockResolvedValue({ id: 'booking-1' });

    const created = await createTransportBooking({
      quoteId: 'quote-1',
      provider: 'MOCK_FRAKTBORS',
      status: 'BOOKED',
      receiverId: 'R1',
      receiverName: 'Receiver',
      wasteCode: '17 05 04',
      tons: 5,
      distanceKm: 12,
      co2EstimateKg: 7.2,
      plannedPickupAt: new Date('2026-01-01T10:00:00.000Z'),
      plannedDeliveryAt: new Date('2026-01-01T11:00:00.000Z'),
      externalReference: 'MFB-123',
    });

    const fetched = await getTransportBooking('booking-1');

    expect(created).toEqual({ id: 'booking-1' });
    expect(fetched).toEqual({ id: 'booking-1' });
    expect(prisma.transportBooking.findUnique).toHaveBeenCalledWith({
      where: { id: 'booking-1' },
      include: { journals: true, limsReports: true },
    });
  });

  it('updates booking status and lists journals', async () => {
    prisma.transportBooking.update.mockResolvedValue({ id: 'booking-1', status: 'DELIVERED' });
    prisma.driverJournal.findMany.mockResolvedValue([{ id: 'journal-1' }]);

    const updated = await updateTransportBookingStatus('booking-1', 'DELIVERED');
    const journals = await listJournalsForBooking('booking-1');

    expect(updated).toEqual({ id: 'booking-1', status: 'DELIVERED' });
    expect(journals).toEqual([{ id: 'journal-1' }]);
    expect(prisma.driverJournal.findMany).toHaveBeenCalledWith({
      where: { bookingId: 'booking-1' },
      orderBy: { startedAt: 'asc' },
    });
  });

  it('creates and updates driver journals with updated timestamps', async () => {
    prisma.driverJournal.create.mockResolvedValue({ id: 'journal-2' });
    prisma.driverJournal.update.mockResolvedValue({ id: 'journal-2', status: 'SIGNED' });

    const created = await createDriverJournal({
      bookingId: 'booking-1',
      driverName: 'Driver One',
      vehicleId: 'ABC123',
      origin: 'Origin',
      destination: 'Destination',
      wasteCode: '17 05 04',
      tons: 5,
      startedAt: new Date('2026-01-01T10:00:00.000Z'),
      endedAt: new Date('2026-01-01T11:00:00.000Z'),
      odometerStartKm: 1000,
      odometerEndKm: 1025,
      gpsTrackHash: 'track-hash-1',
      status: 'IN_PROGRESS',
    });

    const updated = await updateDriverJournal('journal-2', {
      status: 'SIGNED',
      signedByDriver: true,
      signedByReviewer: true,
      driverSignatureId: 'driver-signature',
      reviewerSignatureId: 'reviewer-signature',
      odometerEndKm: 1025,
    });

    expect(created).toEqual({ id: 'journal-2' });
    expect(updated).toEqual({ id: 'journal-2', status: 'SIGNED' });
    expect(prisma.driverJournal.create).toHaveBeenCalledWith({
      data: {
        bookingId: 'booking-1',
        driverName: 'Driver One',
        vehicleId: 'ABC123',
        origin: 'Origin',
        destination: 'Destination',
        wasteCode: '17 05 04',
        tons: 5,
        startedAt: new Date('2026-01-01T10:00:00.000Z'),
        endedAt: new Date('2026-01-01T11:00:00.000Z'),
        odometerStartKm: 1000,
        odometerEndKm: 1025,
        gpsTrackHash: 'track-hash-1',
        status: 'IN_PROGRESS',
      },
    });
    expect(prisma.driverJournal.update).toHaveBeenCalledWith({
      where: { id: 'journal-2' },
      data: {
        status: 'SIGNED',
        signedByDriver: true,
        signedByReviewer: true,
        driverSignatureId: 'driver-signature',
        reviewerSignatureId: 'reviewer-signature',
        odometerEndKm: 1025,
        updatedAt: expect.any(Date),
      },
    });
  });

  it('creates, finds, verifies and lists lims reports', async () => {
    prisma.limsReport.create.mockResolvedValue({ id: 'report-1' });
    prisma.limsReport.findUnique.mockResolvedValue({ id: 'report-1' });
    prisma.limsReport.update.mockResolvedValue({ id: 'report-1', verifiedByHuman: true });
    prisma.limsReport.findMany
      .mockResolvedValueOnce([{ id: 'report-sample' }])
      .mockResolvedValueOnce([{ id: 'report-booking' }]);

    const created = await createLimsReport({
      bookingId: 'booking-1',
      sampleId: 'sample-1',
      labName: 'Lab',
      source: 'API',
      analyzedAt: new Date('2026-01-02T10:00:00.000Z'),
      rawReference: 'ref-1',
      metrics: [],
      passed: true,
    });
    const fetched = await getLimsReport('report-1');
    const verified = await verifyLimsReport('report-1', {
      reviewer: 'QA',
      reviewerSignatureId: 'sig-1',
      verifiedAt: new Date('2026-01-02T11:00:00.000Z'),
      passed: true,
    });
    const bySample = await listLimsReportsBySample('sample-1');
    const byBooking = await listLimsReportsByBooking('booking-1');

    expect(created).toEqual({ id: 'report-1' });
    expect(fetched).toEqual({ id: 'report-1' });
    expect(verified).toEqual({ id: 'report-1', verifiedByHuman: true });
    expect(bySample).toEqual([{ id: 'report-sample' }]);
    expect(byBooking).toEqual([{ id: 'report-booking' }]);
  });

  it('writes gps events with timestamps and supports list/latest/clear', async () => {
    prisma.gpsPosition.create.mockResolvedValue({ id: 'gps-1' });
    prisma.gpsPosition.findMany.mockResolvedValue([{ id: 'gps-1' }]);
    prisma.gpsPosition.findFirst.mockResolvedValue({ id: 'gps-2' });
    prisma.gpsPosition.deleteMany.mockResolvedValue({ count: 2 });

    const created = await addGpsPosition({
      bookingId: 'booking-1',
      lat: 59.3,
      lng: 18.0,
      hash: 'hash-1',
      prevHash: null,
    });
    const track = await getGpsTrack('booking-1');
    const latest = await getLatestPosition('booking-1');
    const cleared = await clearGpsTrack('booking-1');

    expect(created).toEqual({ id: 'gps-1' });
    expect(track).toEqual([{ id: 'gps-1' }]);
    expect(latest).toEqual({ id: 'gps-2' });
    expect(cleared).toBe(2);
    expect(prisma.gpsPosition.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        bookingId: 'booking-1',
        lat: 59.3,
        lng: 18.0,
        hash: 'hash-1',
        prevHash: null,
        timestamp: expect.any(Date),
      }),
    });
  });
});
