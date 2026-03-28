import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createDispatchQuote,
  getDispatchProviderRuntimeStatus,
  isHazardousWasteCode,
  createTransportBooking,
  upsertDriverJournal,
  signDriverJournal,
} from '../../server/services/transportDispatchService';

const mocks = vi.hoisted(() => ({
  createTransportBooking: vi.fn(),
  getTransportBooking: vi.fn(),
  createDriverJournal: vi.fn(),
  updateDriverJournal: vi.fn(),
  findUniqueJournal: vi.fn(),
}));

vi.mock('../../server/repositories/transportRepository', () => ({
  createTransportBooking: mocks.createTransportBooking,
  getTransportBooking: mocks.getTransportBooking,
  createDriverJournal: mocks.createDriverJournal,
  updateDriverJournal: mocks.updateDriverJournal,
}));

vi.mock('../../server/db/prisma', () => ({
  prisma: {
    driverJournal: {
      findUnique: mocks.findUniqueJournal,
    },
  },
}));

vi.mock('../../server/logger', () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
  },
}));

describe('transportDispatchService', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });

  describe('isHazardousWasteCode', () => {
    it('returns true if code contains *', () => {
      expect(isHazardousWasteCode('170106*')).toBe(true);
      expect(isHazardousWasteCode('170101')).toBe(false);
    });
  });

  describe('getDispatchProviderRuntimeStatus', () => {
    it('returns NOT_CONFIGURED if no provider is set', () => {
      delete process.env.DISPATCH_PROVIDER_MODE;
      const status = getDispatchProviderRuntimeStatus();
      expect(status.activeProvider).toBe('NOT_CONFIGURED');
    });

    it('returns TIMOCOM if configured and has key', () => {
      process.env.DISPATCH_PROVIDER_MODE = 'TIMOCOM';
      process.env.TIMOCOM_API_KEY = 'secret';
      const status = getDispatchProviderRuntimeStatus();
      expect(status.activeProvider).toBe('TIMOCOM');
    });

    it('falls back to NOT_CONFIGURED if TIMOCOM lacks key', () => {
      process.env.DISPATCH_PROVIDER_MODE = 'TIMOCOM';
      delete process.env.TIMOCOM_API_KEY;
      const status = getDispatchProviderRuntimeStatus();
      expect(status.activeProvider).toBe('NOT_CONFIGURED');
      expect(status.fallbackActive).toBe(true);
    });
  });

  describe('createDispatchQuote', () => {
    it('calculates cost and emissions correctly for normal waste', () => {
      process.env.DISPATCH_PROVIDER_MODE = 'MOCK_FRAKTBORS';
      const quote = createDispatchQuote({
        receiverId: 'r1',
        receiverName: 'Receiver',
        wasteCode: '170101',
        tons: 10,
        distanceKm: 50,
      });

      expect(quote.provider).toBe('MOCK_FRAKTBORS');
      expect(quote.estimatedCostSek).toBeGreaterThan(0);
      expect(quote.etaHours).toBeDefined();
    });

    it('applies hazardous surcharge', () => {
      process.env.DISPATCH_PROVIDER_MODE = 'MOCK_FRAKTBORS';
      const normal = createDispatchQuote({
        receiverId: 'r1',
        receiverName: 'n',
        wasteCode: '170101',
        tons: 1,
      });
      const hazardous = createDispatchQuote({
        receiverId: 'r1',
        receiverName: 'n',
        wasteCode: '170101*',
        tons: 1,
      });
      expect(hazardous.estimatedCostSek).toBeGreaterThan(normal.estimatedCostSek);
    });

    it('throws if no provider is configured', () => {
      delete process.env.DISPATCH_PROVIDER_MODE;
      expect(() =>
        createDispatchQuote({ receiverId: 'r1', receiverName: 'n', wasteCode: 'w', tons: 1 }),
      ).toThrow('Transportprovider ar inte konfigurerad');
    });

    it('enforces minimum values for tons and distance', () => {
      process.env.DISPATCH_PROVIDER_MODE = 'MOCK_FRAKTBORS';
      const quote = createDispatchQuote({
        receiverId: 'r1',
        receiverName: 'n',
        wasteCode: '170101',
        tons: -5, // Should become 0.1
        distanceKm: 0, // Should become default (15) or 1
      });
      expect(quote.tons).toBe(0.1);
      expect(quote.distanceKm).toBe(15); // Default from ENV or 15
    });
  });

  describe('createTransportBooking', () => {
    it('creates a repo record and returns formatted booking', async () => {
      const mockQuote = {
        id: 'q1',
        provider: 'TIMOCOM' as any,
        receiverId: 'r1',
        receiverName: 'n',
        wasteCode: 'w',
        tons: 10,
        distanceKm: 50,
        estimatedCostSek: 1000,
        etaHours: 2,
        currency: 'SEK' as const,
        createdAt: new Date().toISOString(),
      };
      const mockRepoResult = {
        ...mockQuote,
        quoteId: 'q1',
        status: 'BOOKED',
        co2EstimateKg: 10,
        plannedPickupAt: new Date(),
        plannedDeliveryAt: new Date(),
        externalReference: 'TC-123',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mocks.createTransportBooking.mockResolvedValue(mockRepoResult);

      const booking = await createTransportBooking(mockQuote);
      expect(booking.status).toBe('BOOKED');
      expect(booking.externalReference).toBe('TC-123');
    });
  });

  describe('upsertDriverJournal', () => {
    it('creates a new journal if id is missing', async () => {
      const mockEntry = {
        id: 'j1',
        bookingId: 'b1',
        driverName: 'D',
        vehicleId: 'v1',
        origin: 'A',
        destination: 'B',
        wasteCode: 'w',
        tons: 1,
        startedAt: new Date(),
        odometerStartKm: 0,
        status: 'DRAFT',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mocks.createDriverJournal.mockResolvedValue(mockEntry);

      const journal = await upsertDriverJournal({
        journal: {
          bookingId: 'b1',
          driverName: 'D',
          vehicleId: 'v1',
          origin: 'A',
          destination: 'B',
          wasteCode: 'w',
          tons: 1,
          odometerStartKm: 0,
        },
      });

      expect(journal.id).toBe('j1');
      expect(mocks.createDriverJournal).toHaveBeenCalled();
    });

    it('updates existing journal if id is provided', async () => {
      const mockEntry = {
        id: 'j1',
        startedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mocks.updateDriverJournal.mockResolvedValue(mockEntry);
      await upsertDriverJournal({
        journal: {
          id: 'j1',
          bookingId: 'b1',
          driverName: 'D',
          vehicleId: 'v1',
          origin: 'A',
          destination: 'B',
          wasteCode: 'w',
          tons: 1,
          odometerStartKm: 0,
        },
      });
      expect(mocks.updateDriverJournal).toHaveBeenCalled();
    });

    it('generates a stable and deterministic GPS track hash if missing', async () => {
      const entryData = {
        bookingId: 'b1',
        driverName: 'D',
        vehicleId: 'v1',
        origin: 'A',
        destination: 'B',
        wasteCode: 'w',
        tons: 1,
        odometerStartKm: 100,
        startedAt: '2024-03-25T12:00:00Z',
      };

      const mockEntry = {
        ...entryData,
        id: 'j1',
        startedAt: new Date(entryData.startedAt),
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mocks.createDriverJournal.mockResolvedValue(mockEntry);

      const journal1 = await upsertDriverJournal({ journal: entryData });
      const journal2 = await upsertDriverJournal({ journal: entryData });

      expect(journal1.gpsTrackHash).toBeDefined();
      expect(journal1.gpsTrackHash).toBe(journal2.gpsTrackHash);
      expect(journal1.gpsTrackHash.length).toBe(64); // SHA-256 length
    });

    it('handles invalid date strings by falling back to current time', async () => {
      const mockEntry = {
        id: 'j1',
        startedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mocks.createDriverJournal.mockResolvedValue(mockEntry);

      const journal = await upsertDriverJournal({
        journal: {
          bookingId: 'b1',
          driverName: 'D',
          vehicleId: 'v1',
          origin: 'A',
          destination: 'B',
          wasteCode: 'w',
          tons: 1,
          odometerStartKm: 0,
          startedAt: 'inte-ett-datum',
        },
      });

      expect(new Date(journal.startedAt).getTime()).not.toBeNaN();
    });
  });

  describe('signDriverJournal', () => {
    it('allows driver to sign regardless', async () => {
      mocks.findUniqueJournal.mockResolvedValue({ id: 'j1', signedByDriver: false });
      mocks.updateDriverJournal.mockResolvedValue({
        id: 'j1',
        status: 'SUBMITTED',
        startedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const journal = await signDriverJournal({ journalId: 'j1', signerRole: 'DRIVER', signatureId: 'sig1' });
      expect((journal as any).status).toBe('SUBMITTED');
    });

    it('throws if reviewer signs before driver', async () => {
      mocks.findUniqueJournal.mockResolvedValue({ id: 'j1', signedByDriver: false });
      await expect(
        signDriverJournal({ journalId: 'j1', signerRole: 'REVIEWER', signatureId: 'sig1' })
      ).rejects.toThrow('Driver signature is required');
    });

    it('allows reviewer to sign if driver has signed', async () => {
      mocks.findUniqueJournal.mockResolvedValue({ id: 'j1', signedByDriver: true });
      mocks.updateDriverJournal.mockResolvedValue({ 
        id: 'j1', 
        status: 'VERIFIED', 
        startedAt: new Date(), 
        createdAt: new Date(), 
        updatedAt: new Date() 
      });

      const journal = await signDriverJournal({ journalId: 'j1', signerRole: 'REVIEWER', signatureId: 'sig1' });
      expect((journal as any).status).toBe('VERIFIED');
    });
  });
});
