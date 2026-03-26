import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Prisma mock ───────────────────────────────────────────────────────────────

const transportBookingMock = vi.hoisted(() => ({
  create: vi.fn(),
  findUnique: vi.fn(),
  update: vi.fn(),
}));

const driverJournalMock = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  findMany: vi.fn(),
}));

vi.mock('../../server/db/prisma', () => ({
  prisma: {
    transportBooking: transportBookingMock,
    driverJournal: driverJournalMock,
  },
}));

// ─── Module under test ─────────────────────────────────────────────────────────

import {
  createDriverJournal,
  createTransportBooking,
  getTransportBooking,
  listJournalsForBooking,
  updateDriverJournal,
  updateTransportBookingStatus,
} from '../../server/repositories/transportRepository';

// ─── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

describe('transportRepository', () => {

  // ── createTransportBooking ─────────────────────────────────────────────────

  describe('createTransportBooking', () => {
    it('calls prisma.transportBooking.create with correct data', async () => {
      const data = {
        quoteId: 'q-1',
        provider: 'Ragn-Sells',
        status: 'BOOKED',
        receiverId: 'recv-1',
        receiverName: 'Mottagaren AB',
        wasteCode: '17 05 04',
        tons: 10.5,
        distanceKm: 120,
        co2EstimateKg: 85,
        plannedPickupAt: new Date('2024-07-01'),
        plannedDeliveryAt: new Date('2024-07-02'),
        externalReference: 'EXT-001',
      };

      const created = { id: 'bk-1', ...data };
      transportBookingMock.create.mockResolvedValue(created);

      const result = await createTransportBooking(data);

      expect(transportBookingMock.create).toHaveBeenCalledWith({ data });
      expect(result).toBe(created);
    });

    it('works without optional externalReference', async () => {
      const data = {
        quoteId: 'q-2',
        provider: 'SITA',
        status: 'PENDING',
        receiverId: 'recv-2',
        receiverName: 'Mottagare 2',
        wasteCode: '17 04 05',
        tons: 5,
        distanceKm: 50,
        co2EstimateKg: 30,
        plannedPickupAt: new Date(),
        plannedDeliveryAt: new Date(),
      };

      transportBookingMock.create.mockResolvedValue({ id: 'bk-2' });
      await createTransportBooking(data);
      expect(transportBookingMock.create).toHaveBeenCalledTimes(1);
    });
  });

  // ── getTransportBooking ────────────────────────────────────────────────────

  describe('getTransportBooking', () => {
    it('calls findUnique with id and includes journals + limsReports', async () => {
      const booking = { id: 'bk-get', journals: [], limsReports: [] };
      transportBookingMock.findUnique.mockResolvedValue(booking);

      const result = await getTransportBooking('bk-get');

      expect(transportBookingMock.findUnique).toHaveBeenCalledWith({
        where: { id: 'bk-get' },
        include: { journals: true, limsReports: true },
      });
      expect(result).toBe(booking);
    });

    it('returns null when booking is not found', async () => {
      transportBookingMock.findUnique.mockResolvedValue(null);
      const result = await getTransportBooking('no-such');
      expect(result).toBeNull();
    });
  });

  // ── updateTransportBookingStatus ───────────────────────────────────────────

  describe('updateTransportBookingStatus', () => {
    it('updates status and sets updatedAt', async () => {
      transportBookingMock.update.mockResolvedValue({ id: 'bk-upd', status: 'DELIVERED' });

      const result = await updateTransportBookingStatus('bk-upd', 'DELIVERED');

      expect(transportBookingMock.update).toHaveBeenCalledWith({
        where: { id: 'bk-upd' },
        data: expect.objectContaining({ status: 'DELIVERED', updatedAt: expect.any(Date) }),
      });
      expect(result).toEqual({ id: 'bk-upd', status: 'DELIVERED' });
    });
  });

  // ── createDriverJournal ────────────────────────────────────────────────────

  describe('createDriverJournal', () => {
    it('calls prisma.driverJournal.create with the provided data', async () => {
      const data = {
        bookingId: 'bk-dj-1',
        driverName: 'Lars Larsson',
        vehicleId: 'VH-001',
        origin: 'Stockholm',
        destination: 'Göteborg',
        wasteCode: '17 05 04',
        tons: 8,
        startedAt: new Date('2024-07-01T08:00:00Z'),
        endedAt: new Date('2024-07-01T14:00:00Z'),
        odometerStartKm: 10000,
        odometerEndKm: 10450,
        gpsTrackHash: 'gps-hash-123',
        status: 'COMPLETED',
      };

      const created = { id: 'dj-1', ...data };
      driverJournalMock.create.mockResolvedValue(created);

      const result = await createDriverJournal(data);

      expect(driverJournalMock.create).toHaveBeenCalledWith({ data });
      expect(result).toBe(created);
    });
  });

  // ── updateDriverJournal ────────────────────────────────────────────────────

  describe('updateDriverJournal', () => {
    it('calls prisma.driverJournal.update with id, partial data and updatedAt', async () => {
      const partial = { status: 'SIGNED', signedByDriver: true };
      driverJournalMock.update.mockResolvedValue({ id: 'dj-upd', ...partial });

      await updateDriverJournal('dj-upd', partial);

      expect(driverJournalMock.update).toHaveBeenCalledWith({
        where: { id: 'dj-upd' },
        data: expect.objectContaining({ status: 'SIGNED', signedByDriver: true, updatedAt: expect.any(Date) }),
      });
    });

    it('supports updating odometerEndKm and endedAt', async () => {
      const partial = { odometerEndKm: 10500, endedAt: new Date('2024-07-01T15:00:00Z') };
      driverJournalMock.update.mockResolvedValue({ id: 'dj-end' });

      await updateDriverJournal('dj-end', partial);

      const call = driverJournalMock.update.mock.calls[0][0];
      expect(call.data.odometerEndKm).toBe(10500);
    });
  });

  // ── listJournalsForBooking ─────────────────────────────────────────────────

  describe('listJournalsForBooking', () => {
    it('calls findMany with bookingId filter and ascending startedAt order', async () => {
      driverJournalMock.findMany.mockResolvedValue([]);

      await listJournalsForBooking('bk-list');

      expect(driverJournalMock.findMany).toHaveBeenCalledWith({
        where: { bookingId: 'bk-list' },
        orderBy: { startedAt: 'asc' },
      });
    });

    it('returns sorted journals', async () => {
      const journals = [{ id: 'j1' }, { id: 'j2' }];
      driverJournalMock.findMany.mockResolvedValue(journals);

      const result = await listJournalsForBooking('bk-j');
      expect(result).toEqual(journals);
    });
  });
});
