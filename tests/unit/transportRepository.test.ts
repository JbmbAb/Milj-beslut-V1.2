import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  transportBookingCreate: vi.fn(),
  transportBookingFindUnique: vi.fn(),
  transportBookingUpdate: vi.fn(),
  driverJournalCreate: vi.fn(),
  driverJournalUpdate: vi.fn(),
  driverJournalFindMany: vi.fn(),
}));

vi.mock('../../server/db/prisma', () => ({
  prisma: {
    transportBooking: {
      create: mocks.transportBookingCreate,
      findUnique: mocks.transportBookingFindUnique,
      update: mocks.transportBookingUpdate,
    },
    driverJournal: {
      create: mocks.driverJournalCreate,
      update: mocks.driverJournalUpdate,
      findMany: mocks.driverJournalFindMany,
    },
  },
}));

import {
  createTransportBooking,
  getTransportBooking,
  updateTransportBookingStatus,
  createDriverJournal,
  updateDriverJournal,
  listJournalsForBooking,
} from '../../server/repositories/transportRepository';

describe('transportRepository', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('createTransportBooking', () => {
    it('creates a transport booking with required fields', async () => {
      const input = {
        quoteId: 'quote-1',
        provider: 'TransCo',
        status: 'PENDING',
        receiverId: 'recv-1',
        receiverName: 'Receiver AB',
        wasteCode: 'EWC-01',
        tons: 5.0,
        distanceKm: 120,
        co2EstimateKg: 60,
        plannedPickupAt: new Date('2024-04-01'),
        plannedDeliveryAt: new Date('2024-04-02'),
      };
      const created = { id: 'booking-1', ...input };
      mocks.transportBookingCreate.mockResolvedValue(created);

      const result = await createTransportBooking(input);

      expect(mocks.transportBookingCreate).toHaveBeenCalledWith({ data: input });
      expect(result).toEqual(created);
    });

    it('creates a transport booking with optional externalReference', async () => {
      const input = {
        quoteId: 'quote-2',
        provider: 'FreightLtd',
        status: 'CONFIRMED',
        receiverId: 'recv-2',
        receiverName: 'Depot AB',
        wasteCode: 'EWC-02',
        tons: 10.0,
        distanceKm: 200,
        co2EstimateKg: 100,
        plannedPickupAt: new Date('2024-05-01'),
        plannedDeliveryAt: new Date('2024-05-03'),
        externalReference: 'EXT-REF-999',
      };
      mocks.transportBookingCreate.mockResolvedValue({ id: 'booking-2', ...input });

      await createTransportBooking(input);

      expect(mocks.transportBookingCreate).toHaveBeenCalledWith({ data: input });
    });
  });

  describe('getTransportBooking', () => {
    it('returns booking with journals and limsReports included', async () => {
      const booking = {
        id: 'booking-1',
        status: 'PENDING',
        journals: [],
        limsReports: [],
      };
      mocks.transportBookingFindUnique.mockResolvedValue(booking);

      const result = await getTransportBooking('booking-1');

      expect(mocks.transportBookingFindUnique).toHaveBeenCalledWith({
        where: { id: 'booking-1' },
        include: { journals: true, limsReports: true },
      });
      expect(result).toEqual(booking);
    });

    it('returns null when booking is not found', async () => {
      mocks.transportBookingFindUnique.mockResolvedValue(null);

      const result = await getTransportBooking('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('updateTransportBookingStatus', () => {
    it('updates status and sets updatedAt', async () => {
      const updated = { id: 'booking-1', status: 'COMPLETED' };
      mocks.transportBookingUpdate.mockResolvedValue(updated);

      const before = new Date();
      const result = await updateTransportBookingStatus('booking-1', 'COMPLETED');
      const after = new Date();

      expect(mocks.transportBookingUpdate).toHaveBeenCalledOnce();
      const callArg = mocks.transportBookingUpdate.mock.calls[0][0];
      expect(callArg.where).toEqual({ id: 'booking-1' });
      expect(callArg.data.status).toBe('COMPLETED');
      expect(callArg.data.updatedAt).toBeInstanceOf(Date);
      expect(callArg.data.updatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(callArg.data.updatedAt.getTime()).toBeLessThanOrEqual(after.getTime());
      expect(result).toEqual(updated);
    });
  });

  describe('createDriverJournal', () => {
    it('creates a driver journal with required fields', async () => {
      const input = {
        bookingId: 'booking-1',
        driverName: 'Lars Svensson',
        vehicleId: 'vehicle-abc',
        origin: 'Göteborg',
        destination: 'Stockholm',
        wasteCode: 'EWC-01',
        tons: 3.5,
        startedAt: new Date('2024-04-01T08:00:00'),
        odometerStartKm: 10000,
        status: 'IN_PROGRESS',
      };
      const created = { id: 'journal-1', ...input };
      mocks.driverJournalCreate.mockResolvedValue(created);

      const result = await createDriverJournal(input);

      expect(mocks.driverJournalCreate).toHaveBeenCalledWith({ data: input });
      expect(result).toEqual(created);
    });

    it('creates a driver journal with all optional fields', async () => {
      const input = {
        bookingId: 'booking-2',
        driverName: 'Erik Johansson',
        vehicleId: 'vehicle-xyz',
        origin: 'Malmö',
        destination: 'Lund',
        wasteCode: 'EWC-05',
        tons: 2.0,
        startedAt: new Date('2024-04-02T07:00:00'),
        endedAt: new Date('2024-04-02T10:00:00'),
        odometerStartKm: 5000,
        odometerEndKm: 5100,
        gpsTrackHash: 'hash-abc123',
        status: 'COMPLETED',
      };
      mocks.driverJournalCreate.mockResolvedValue({ id: 'journal-2', ...input });

      await createDriverJournal(input);

      expect(mocks.driverJournalCreate).toHaveBeenCalledWith({ data: input });
    });
  });

  describe('updateDriverJournal', () => {
    it('updates partial journal fields and sets updatedAt', async () => {
      const updateData = { status: 'COMPLETED', odometerEndKm: 10150 };
      const updated = { id: 'journal-1', ...updateData };
      mocks.driverJournalUpdate.mockResolvedValue(updated);

      const before = new Date();
      const result = await updateDriverJournal('journal-1', updateData);
      const after = new Date();

      expect(mocks.driverJournalUpdate).toHaveBeenCalledOnce();
      const callArg = mocks.driverJournalUpdate.mock.calls[0][0];
      expect(callArg.where).toEqual({ id: 'journal-1' });
      expect(callArg.data.status).toBe('COMPLETED');
      expect(callArg.data.odometerEndKm).toBe(10150);
      expect(callArg.data.updatedAt).toBeInstanceOf(Date);
      expect(callArg.data.updatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(callArg.data.updatedAt.getTime()).toBeLessThanOrEqual(after.getTime());
      expect(result).toEqual(updated);
    });

    it('updates signature fields for driver sign-off', async () => {
      const updateData = { signedByDriver: true, driverSignatureId: 'sig-drv-1' };
      mocks.driverJournalUpdate.mockResolvedValue({ id: 'journal-2', ...updateData });

      await updateDriverJournal('journal-2', updateData);

      const callArg = mocks.driverJournalUpdate.mock.calls[0][0];
      expect(callArg.data.signedByDriver).toBe(true);
      expect(callArg.data.driverSignatureId).toBe('sig-drv-1');
    });
  });

  describe('listJournalsForBooking', () => {
    it('returns journals ordered by startedAt asc', async () => {
      const journals = [
        { id: 'j1', bookingId: 'booking-1', startedAt: new Date('2024-04-01') },
        { id: 'j2', bookingId: 'booking-1', startedAt: new Date('2024-04-02') },
      ];
      mocks.driverJournalFindMany.mockResolvedValue(journals);

      const result = await listJournalsForBooking('booking-1');

      expect(mocks.driverJournalFindMany).toHaveBeenCalledWith({
        where: { bookingId: 'booking-1' },
        orderBy: { startedAt: 'asc' },
      });
      expect(result).toEqual(journals);
    });

    it('returns empty array when booking has no journals', async () => {
      mocks.driverJournalFindMany.mockResolvedValue([]);

      const result = await listJournalsForBooking('booking-empty');

      expect(result).toEqual([]);
    });
  });
});
