import { describe, expect, it } from 'vitest';
import {
  isHazardousWasteCode,
  createDispatchQuote,
  createTransportBooking,
  upsertDriverJournal,
  signDriverJournal,
} from '../../server/services/transportDispatchService';
import type { DispatchQuote, DriverJournalEntry } from '../../types';

// ─── isHazardousWasteCode ─────────────────────────────────────────────────────

describe('isHazardousWasteCode', () => {
  it('returns true when wasteCode contains asterisk', () => {
    expect(isHazardousWasteCode('13 01 01*')).toBe(true);
    expect(isHazardousWasteCode('*')).toBe(true);
  });

  it('returns false when wasteCode has no asterisk', () => {
    expect(isHazardousWasteCode('20 03 01')).toBe(false);
    expect(isHazardousWasteCode('')).toBe(false);
  });

  it('handles null/undefined gracefully', () => {
    expect(isHazardousWasteCode(null as unknown as string)).toBe(false);
    expect(isHazardousWasteCode(undefined as unknown as string)).toBe(false);
  });
});

// ─── createDispatchQuote ──────────────────────────────────────────────────────

describe('createDispatchQuote', () => {
  const baseInput = {
    receiverId: 'REC-001',
    receiverName: 'Mottagare AB',
    wasteCode: '20 03 01',
    tons: 5,
    distanceKm: 50,
  };

  it('creates a quote with expected structure', () => {
    const quote = createDispatchQuote(baseInput);
    expect(quote.id).toMatch(/^QUOTE-/);
    expect(quote.receiverId).toBe('REC-001');
    expect(quote.receiverName).toBe('Mottagare AB');
    expect(quote.tons).toBe(5);
    expect(quote.distanceKm).toBe(50);
    expect(quote.currency).toBe('SEK');
    expect(typeof quote.estimatedCostSek).toBe('number');
    expect(typeof quote.etaHours).toBe('number');
  });

  it('adds hazardous surcharge for waste codes with asterisk', () => {
    const hazardous = createDispatchQuote({ ...baseInput, wasteCode: '13 01 01*' });
    const normal = createDispatchQuote(baseInput);
    expect(hazardous.estimatedCostSek).toBeGreaterThan(normal.estimatedCostSek);
  });

  it('uses default distance when distanceKm is not provided', () => {
    const quote = createDispatchQuote({ ...baseInput, distanceKm: undefined });
    expect(quote.distanceKm).toBeGreaterThan(0);
  });

  it('enforces minimum tons of 0.1', () => {
    const quote = createDispatchQuote({ ...baseInput, tons: 0 });
    expect(quote.tons).toBe(0.1);
  });

  it('trims whitespace from receiverId and receiverName', () => {
    const quote = createDispatchQuote({ ...baseInput, receiverId: '  REC-001  ', receiverName: '  Mottagare AB  ' });
    expect(quote.receiverId).toBe('REC-001');
    expect(quote.receiverName).toBe('Mottagare AB');
  });
});

// ─── createTransportBooking ───────────────────────────────────────────────────

describe('createTransportBooking', () => {
  const mockQuote: DispatchQuote = {
    id: 'QUOTE-abc',
    provider: 'TIMOCOM',
    receiverId: 'REC-001',
    receiverName: 'Mottagare AB',
    wasteCode: '20 03 01',
    tons: 5,
    distanceKm: 50,
    estimatedCostSek: 600,
    etaHours: 1,
    currency: 'SEK',
    createdAt: new Date().toISOString(),
  };

  it('creates a booking with expected structure', () => {
    const booking = createTransportBooking(mockQuote);
    expect(booking.id).toMatch(/^BOOKING-/);
    expect(booking.quoteId).toBe('QUOTE-abc');
    expect(booking.status).toBe('BOOKED');
    expect(booking.tons).toBe(5);
    expect(typeof booking.co2EstimateKg).toBe('number');
    expect(booking.co2EstimateKg).toBeGreaterThan(0);
  });

  it('sets delivery date after pickup', () => {
    const pickup = new Date('2025-06-01T08:00:00Z').toISOString();
    const booking = createTransportBooking(mockQuote, { plannedPickupAt: pickup });
    const pickupDate = new Date(booking.plannedPickupAt);
    const deliveryDate = new Date(booking.plannedDeliveryAt);
    expect(deliveryDate.getTime()).toBeGreaterThan(pickupDate.getTime());
  });
});

// ─── upsertDriverJournal ──────────────────────────────────────────────────────

describe('upsertDriverJournal', () => {
  const baseJournal = {
    bookingId: 'BOOKING-001',
    driverName: 'Anna Svensson',
    vehicleId: 'VEH-001',
    origin: 'Stockholm',
    destination: 'Göteborg',
    wasteCode: '20 03 01',
    tons: 3,
    odometerStartKm: 1000,
  };

  it('creates a new journal entry', () => {
    const result = upsertDriverJournal({ journals: [], journal: baseJournal });
    expect(result.journal.id).toMatch(/^JOURNAL-/);
    expect(result.journal.driverName).toBe('Anna Svensson');
    expect(result.journal.status).toBe('DRAFT');
    expect(result.journals).toHaveLength(1);
  });

  it('sets status to SUBMITTED when endedAt is provided', () => {
    const result = upsertDriverJournal({
      journals: [],
      journal: { ...baseJournal, endedAt: new Date().toISOString() },
    });
    expect(result.journal.status).toBe('SUBMITTED');
  });

  it('throws when odometerEndKm is less than odometerStartKm', () => {
    expect(() =>
      upsertDriverJournal({
        journals: [],
        journal: { ...baseJournal, odometerStartKm: 1000, odometerEndKm: 900 },
      })
    ).toThrow('odometerEndKm must be >= odometerStartKm');
  });

  it('updates an existing journal entry', () => {
    const first = upsertDriverJournal({ journals: [], journal: baseJournal });
    const updated = upsertDriverJournal({
      journals: first.journals,
      journal: { ...baseJournal, id: first.journal.id, driverName: 'Erik Larsson' },
    });
    expect(updated.journals).toHaveLength(1);
    expect(updated.journal.driverName).toBe('Erik Larsson');
  });

  it('generates stable gpsTrackHash for same inputs', () => {
    const r1 = upsertDriverJournal({ journals: [], journal: { ...baseJournal, startedAt: '2025-06-01T08:00:00Z' } });
    const r2 = upsertDriverJournal({ journals: [], journal: { ...baseJournal, startedAt: '2025-06-01T08:00:00Z' } });
    expect(r1.journal.gpsTrackHash).toBe(r2.journal.gpsTrackHash);
  });
});

// ─── signDriverJournal ────────────────────────────────────────────────────────

describe('signDriverJournal', () => {
  const draftEntry: DriverJournalEntry = {
    id: 'JOURNAL-001',
    bookingId: 'BOOKING-001',
    driverName: 'Anna Svensson',
    vehicleId: 'VEH-001',
    origin: 'Stockholm',
    destination: 'Göteborg',
    wasteCode: '20 03 01',
    tons: 3,
    startedAt: '2025-06-01T08:00:00Z',
    endedAt: '2025-06-01T10:00:00Z',
    odometerStartKm: 1000,
    odometerEndKm: 1200,
    gpsTrackHash: 'abc123',
    status: 'SUBMITTED',
    signedByDriver: false,
    signedByReviewer: false,
    driverSignatureId: null,
    reviewerSignatureId: null,
    createdAt: '2025-06-01T08:00:00Z',
    updatedAt: '2025-06-01T10:00:00Z',
  };

  it('driver can sign a journal', () => {
    const signed = signDriverJournal({ journal: draftEntry, signerRole: 'DRIVER', signatureId: 'SIG-DRIVER-001' });
    expect(signed.signedByDriver).toBe(true);
    expect(signed.driverSignatureId).toBe('SIG-DRIVER-001');
  });

  it('reviewer can sign after driver has signed', () => {
    const driverSigned = signDriverJournal({ journal: draftEntry, signerRole: 'DRIVER', signatureId: 'SIG-D' });
    const fullySigned = signDriverJournal({ journal: driverSigned, signerRole: 'REVIEWER', signatureId: 'SIG-R' });
    expect(fullySigned.signedByReviewer).toBe(true);
    expect(fullySigned.status).toBe('VERIFIED');
  });

  it('throws if reviewer signs before driver', () => {
    expect(() =>
      signDriverJournal({ journal: draftEntry, signerRole: 'REVIEWER', signatureId: 'SIG-R' })
    ).toThrow('Driver signature is required before reviewer signature');
  });

  it('throws if signatureId is empty', () => {
    expect(() =>
      signDriverJournal({ journal: draftEntry, signerRole: 'DRIVER', signatureId: '   ' })
    ).toThrow('signatureId is required');
  });
});
