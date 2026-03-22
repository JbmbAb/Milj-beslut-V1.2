import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
  createTransportBookingRepo: vi.fn(),
  getTransportBookingRepo: vi.fn(),
  createDriverJournalRepo: vi.fn(),
  updateDriverJournalRepo: vi.fn(),
  findJournal: vi.fn(),
}));

vi.mock('../../server/logger', () => ({
  logger: mocks.logger,
}));

vi.mock('../../server/repositories/transportRepository', () => ({
  createTransportBooking: mocks.createTransportBookingRepo,
  getTransportBooking: mocks.getTransportBookingRepo,
  createDriverJournal: mocks.createDriverJournalRepo,
  updateDriverJournal: mocks.updateDriverJournalRepo,
  listJournalsForBooking: vi.fn(),
  updateTransportBookingStatus: vi.fn(),
}));

vi.mock('../../server/db/prisma', () => ({
  prisma: {
    driverJournal: {
      findUnique: mocks.findJournal,
    },
  },
}));

import {
  createDispatchQuote,
  createTransportBooking,
  getDispatchProviderRuntimeStatus,
  getTransportBooking,
  signDriverJournal,
  upsertDriverJournal,
} from '../../server/services/transportDispatchService';

function bookingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'booking-1',
    quoteId: 'quote-1',
    provider: 'MOCK_FRAKTBORS',
    status: 'BOOKED',
    receiverId: 'R1',
    receiverName: 'Receiver',
    wasteCode: '17 05 03*',
    tons: 9,
    distanceKm: 20,
    co2EstimateKg: 21.6,
    plannedPickupAt: new Date('2026-01-01T10:00:00.000Z'),
    plannedDeliveryAt: new Date('2026-01-01T12:00:00.000Z'),
    externalReference: 'MFB-123456',
    createdAt: new Date('2026-01-01T09:00:00.000Z'),
    updatedAt: new Date('2026-01-01T09:05:00.000Z'),
    journals: [],
    limsReports: [],
    ...overrides,
  };
}

function journalRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'journal-1',
    bookingId: 'booking-1',
    driverName: 'Driver',
    vehicleId: 'ABC123',
    origin: 'Site A',
    destination: 'Site B',
    wasteCode: '17 05 03*',
    tons: 9,
    startedAt: new Date('2026-01-01T10:00:00.000Z'),
    endedAt: new Date('2026-01-01T12:00:00.000Z'),
    odometerStartKm: 1000,
    odometerEndKm: 1020,
    gpsTrackHash: 'hash-1',
    status: 'DRAFT',
    signedByDriver: false,
    signedByReviewer: false,
    driverSignatureId: null,
    reviewerSignatureId: null,
    createdAt: new Date('2026-01-01T09:00:00.000Z'),
    updatedAt: new Date('2026-01-01T09:05:00.000Z'),
    ...overrides,
  };
}

describe('transportDispatchService', () => {
  const originalMode = process.env.DISPATCH_PROVIDER_MODE;
  const originalTimocomKey = process.env.TIMOCOM_API_KEY;
  const originalTransEuKey = process.env.TRANS_EU_API_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
    if (originalMode === undefined) delete process.env.DISPATCH_PROVIDER_MODE;
    else process.env.DISPATCH_PROVIDER_MODE = originalMode;
    if (originalTimocomKey === undefined) delete process.env.TIMOCOM_API_KEY;
    else process.env.TIMOCOM_API_KEY = originalTimocomKey;
    if (originalTransEuKey === undefined) delete process.env.TRANS_EU_API_KEY;
    else process.env.TRANS_EU_API_KEY = originalTransEuKey;
  });

  it('supports mock provider runtime status for tests and demos', () => {
    process.env.DISPATCH_PROVIDER_MODE = 'MOCK_FRAKTBORS';

    const status = getDispatchProviderRuntimeStatus();

    expect(status.requestedProvider).toBe('MOCK_FRAKTBORS');
    expect(status.activeProvider).toBe('MOCK_FRAKTBORS');
    expect(status.fallbackActive).toBe(false);
  });

  it('falls back when a configured provider lacks credentials', () => {
    process.env.DISPATCH_PROVIDER_MODE = 'TIMOCOM';
    delete process.env.TIMOCOM_API_KEY;

    const status = getDispatchProviderRuntimeStatus();

    expect(status.requestedProvider).toBe('TIMOCOM');
    expect(status.activeProvider).toBe('NOT_CONFIGURED');
    expect(status.fallbackActive).toBe(true);
    expect(mocks.logger.warn).toHaveBeenCalled();
  });

  it('creates hazardous dispatch quotes when mock provider is enabled', () => {
    process.env.DISPATCH_PROVIDER_MODE = 'MOCK_FRAKTBORS';

    const quote = createDispatchQuote({
      receiverId: 'R2',
      receiverName: 'Haz Receiver',
      wasteCode: '17 05 03*',
      tons: 9,
      distanceKm: 20,
    });

    expect(quote.id).toMatch(/^QUOTE-/);
    expect(quote.provider).toBe('MOCK_FRAKTBORS');
    expect(quote.estimatedCostSek).toBeGreaterThan(0);
    expect(quote.etaHours).toBeGreaterThan(0);
  });

  it('blocks quote creation when no provider is configured', () => {
    delete process.env.DISPATCH_PROVIDER_MODE;

    expect(() =>
      createDispatchQuote({
        receiverId: 'R1',
        receiverName: 'Receiver',
        wasteCode: '17 05 04',
        tons: 5,
      }),
    ).toThrow(/Transportprovider ar inte konfigurerad/i);
  });

  it('maps bookings returned from the repository', async () => {
    process.env.DISPATCH_PROVIDER_MODE = 'MOCK_FRAKTBORS';
    mocks.createTransportBookingRepo.mockResolvedValue(bookingRow());
    mocks.getTransportBookingRepo.mockResolvedValue(bookingRow({ id: 'booking-2' }));

    const quote = createDispatchQuote({
      receiverId: 'R1',
      receiverName: 'Receiver',
      wasteCode: '17 05 04',
      tons: 5,
      distanceKm: 12,
    });
    const created = await createTransportBooking(quote, {
      plannedPickupAt: '2026-01-01T10:00:00.000Z',
    });
    const fetched = await getTransportBooking('booking-2');

    expect(created.id).toBe('booking-1');
    expect(created.provider).toBe('MOCK_FRAKTBORS');
    expect(created.plannedPickupAt).toBe('2026-01-01T10:00:00.000Z');
    expect(fetched?.id).toBe('booking-2');
    expect(mocks.createTransportBookingRepo).toHaveBeenCalledWith(
      expect.objectContaining({
        quoteId: quote.id,
        provider: 'MOCK_FRAKTBORS',
        receiverId: 'R1',
      }),
    );
  });

  it('creates and updates driver journals via the repository layer', async () => {
    mocks.createDriverJournalRepo.mockResolvedValue(journalRow());
    mocks.updateDriverJournalRepo.mockResolvedValue(journalRow({ id: 'journal-2', status: 'SUBMITTED' }));

    const created = await upsertDriverJournal({
      journal: {
        bookingId: 'booking-1',
        driverName: 'Driver',
        vehicleId: 'ABC123',
        origin: 'Site A',
        destination: 'Site B',
        wasteCode: '17 05 04',
        tons: 5,
        odometerStartKm: 1000,
      },
    });
    const updated = await upsertDriverJournal({
      journal: {
        id: 'journal-2',
        bookingId: 'booking-1',
        driverName: 'Driver',
        vehicleId: 'ABC123',
        origin: 'Site A',
        destination: 'Site B',
        wasteCode: '17 05 04',
        tons: 5,
        odometerStartKm: 1000,
        endedAt: '2026-01-01T12:00:00.000Z',
        odometerEndKm: 1020,
      },
    });

    expect(created.id).toBe('journal-1');
    expect(created.gpsTrackHash).toBe('hash-1');
    expect(updated.id).toBe('journal-2');
    expect(mocks.createDriverJournalRepo).toHaveBeenCalledWith(
      expect.objectContaining({
        bookingId: 'booking-1',
        gpsTrackHash: expect.any(String),
        status: 'DRAFT',
      }),
    );
    expect(mocks.updateDriverJournalRepo).toHaveBeenCalledWith(
      'journal-2',
      expect.objectContaining({
        odometerEndKm: 1020,
      }),
    );
  });

  it('prevents reviewer signatures before the driver has signed', async () => {
    mocks.findJournal.mockResolvedValue(journalRow({ signedByDriver: false }));

    await expect(
      signDriverJournal({
        journalId: 'journal-1',
        signerRole: 'REVIEWER',
        signatureId: 'sig-review',
      }),
    ).rejects.toThrow(/Driver signature is required/i);
  });

  it('signs verified journals when the reviewer path is valid', async () => {
    mocks.findJournal.mockResolvedValue(journalRow({ signedByDriver: true }));
    mocks.updateDriverJournalRepo.mockResolvedValue(
      journalRow({
        status: 'VERIFIED',
        signedByDriver: true,
        signedByReviewer: true,
        reviewerSignatureId: 'sig-review',
      }),
    );

    const signed = await signDriverJournal({
      journalId: 'journal-1',
      signerRole: 'REVIEWER',
      signatureId: 'sig-review',
    });

    expect(signed.status).toBe('VERIFIED');
    expect(signed.signedByReviewer).toBe(true);
    expect(mocks.updateDriverJournalRepo).toHaveBeenCalledWith(
      'journal-1',
      expect.objectContaining({
        signedByReviewer: true,
        reviewerSignatureId: 'sig-review',
        status: 'VERIFIED',
      }),
    );
  });
});
