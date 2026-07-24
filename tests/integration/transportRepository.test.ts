import { prisma } from '../../server/db/prisma';
import { it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

import {
  createTransportBooking,
  getTransportBooking,
  updateTransportBookingStatus,
  createDriverJournal,
  updateDriverJournal,
  listJournalsForBooking,
} from '../../server/repositories/transportRepository';
import { describeIfDatabaseIntegration } from './integrationTestEnv';

describeIfDatabaseIntegration('transportRepository Integration', () => {
  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    // Clean up related tables before each test to ensure isolation
    await prisma.driverJournal.deleteMany({});
    await prisma.transportBooking.deleteMany({});
  });

  it('should create and retrieve a transport booking', async () => {
    const bookingData = {
      quoteId: 'quote-1',
      provider: 'MOCK_FRAKTBORS',
      status: 'QUOTED',
      receiverId: 'rec-1',
      receiverName: 'Receiver One',
      wasteCode: '17 05 04',
      tons: 10,
      distanceKm: 100,
      co2EstimateKg: 200,
      plannedPickupAt: new Date(),
      plannedDeliveryAt: new Date(Date.now() + 24 * 3600 * 1000),
    };

    const createdBooking = await createTransportBooking(bookingData);
    expect(createdBooking).toBeDefined();
    expect(createdBooking.id).toBeDefined();
    expect(createdBooking.status).toBe('QUOTED');

    const retrievedBooking = await getTransportBooking(createdBooking.id);
    expect(retrievedBooking).toEqual(expect.objectContaining(bookingData));
    expect(retrievedBooking?.journals).toEqual([]); // No journals yet
    expect(retrievedBooking?.limsReports).toEqual([]); // No LIMS reports yet
  });

  it('should update a transport booking status', async () => {
    const bookingData = {
      quoteId: 'quote-2',
      provider: 'MOCK_FRAKTBORS',
      status: 'QUOTED',
      receiverId: 'rec-2',
      receiverName: 'Receiver Two',
      wasteCode: '17 05 04',
      tons: 5,
      distanceKm: 50,
      co2EstimateKg: 100,
      plannedPickupAt: new Date(),
      plannedDeliveryAt: new Date(Date.now() + 12 * 3600 * 1000),
    };
    const createdBooking = await createTransportBooking(bookingData);

    const updatedBooking = await updateTransportBookingStatus(createdBooking.id, 'BOOKED');
    expect(updatedBooking.status).toBe('BOOKED');
    expect(updatedBooking.updatedAt).toBeInstanceOf(Date);
    expect(updatedBooking.updatedAt.getTime()).toBeGreaterThan(createdBooking.createdAt.getTime());
  });

  it('should create a driver journal', async () => {
    const bookingData = {
      quoteId: 'quote-3',
      provider: 'MOCK_FRAKTBORS',
      status: 'BOOKED',
      receiverId: 'rec-3',
      receiverName: 'Receiver Three',
      wasteCode: '17 05 04',
      tons: 20,
      distanceKm: 200,
      co2EstimateKg: 400,
      plannedPickupAt: new Date(),
      plannedDeliveryAt: new Date(Date.now() + 48 * 3600 * 1000),
    };
    const booking = await createTransportBooking(bookingData);

    const journalData = {
      bookingId: booking.id,
      driverName: 'Driver A',
      vehicleId: 'VEH-001',
      origin: 'Origin A',
      destination: 'Destination A',
      wasteCode: '17 05 04',
      tons: 20,
      startedAt: new Date(),
      odometerStartKm: 10000,
      status: 'DRAFT',
    };

    const createdJournal = await createDriverJournal(journalData);
    expect(createdJournal).toBeDefined();
    expect(createdJournal.id).toBeDefined();
    expect(createdJournal.driverName).toBe('Driver A');
    expect(createdJournal.status).toBe('DRAFT');
  });

  it('should update a driver journal', async () => {
    const booking = await createTransportBooking({
      quoteId: 'quote-4',
      provider: 'MOCK_FRAKTBORS',
      status: 'BOOKED',
      receiverId: 'rec-4',
      receiverName: 'R4',
      wasteCode: '17 05 04',
      tons: 1,
      distanceKm: 1,
      co2EstimateKg: 1,
      plannedPickupAt: new Date(),
      plannedDeliveryAt: new Date(),
    });
    const journal = await createDriverJournal({
      bookingId: booking.id,
      driverName: 'Driver B',
      vehicleId: 'VEH-002',
      origin: 'O B',
      destination: 'D B',
      wasteCode: '17 05 04',
      tons: 1,
      startedAt: new Date(),
      odometerStartKm: 20000,
      status: 'DRAFT',
    });

    const updateData = {
      status: 'VERIFIED',
      endedAt: new Date(),
      odometerEndKm: 20050,
      signedByDriver: true,
      reviewerSignatureId: 'sig-reviewer-1',
    };

    const updatedJournal = await updateDriverJournal(journal.id, updateData);
    expect(updatedJournal.status).toBe('VERIFIED');
    expect(updatedJournal.endedAt).toEqual(updateData.endedAt);
    expect(updatedJournal.odometerEndKm).toBe(updateData.odometerEndKm);
    expect(updatedJournal.signedByDriver).toBe(true);
    expect(updatedJournal.reviewerSignatureId).toBe('sig-reviewer-1');
  });

  it('should list journals for a specific booking', async () => {
    const booking1 = await createTransportBooking({
      quoteId: 'quote-5',
      provider: 'MOCK_FRAKTBORS',
      status: 'BOOKED',
      receiverId: 'rec-5',
      receiverName: 'R5',
      wasteCode: '17 05 04',
      tons: 1,
      distanceKm: 1,
      co2EstimateKg: 1,
      plannedPickupAt: new Date(),
      plannedDeliveryAt: new Date(),
    });
    const booking2 = await createTransportBooking({
      quoteId: 'quote-6',
      provider: 'MOCK_FRAKTBORS',
      status: 'BOOKED',
      receiverId: 'rec-6',
      receiverName: 'R6',
      wasteCode: '17 05 04',
      tons: 1,
      distanceKm: 1,
      co2EstimateKg: 1,
      plannedPickupAt: new Date(),
      plannedDeliveryAt: new Date(),
    });

    const journal1 = await createDriverJournal({
      bookingId: booking1.id,
      driverName: 'D1',
      vehicleId: 'V1',
      origin: 'O1',
      destination: 'D1',
      wasteCode: '17 05 04',
      tons: 1,
      startedAt: new Date(),
      odometerStartKm: 1,
      status: 'DRAFT',
    });
    const journal2 = await createDriverJournal({
      bookingId: booking1.id,
      driverName: 'D2',
      vehicleId: 'V2',
      origin: 'O2',
      destination: 'D2',
      wasteCode: '17 05 04',
      tons: 1,
      startedAt: new Date(Date.now() + 1000),
      odometerStartKm: 2,
      status: 'DRAFT',
    });
    await createDriverJournal({
      bookingId: booking2.id,
      driverName: 'D3',
      vehicleId: 'V3',
      origin: 'O3',
      destination: 'D3',
      wasteCode: '17 05 04',
      tons: 1,
      startedAt: new Date(),
      odometerStartKm: 3,
      status: 'DRAFT',
    });

    const journals = await listJournalsForBooking(booking1.id);
    expect(journals.length).toBe(2);
    expect(journals.some((j) => j.id === journal1.id)).toBe(true);
    expect(journals.some((j) => j.id === journal2.id)).toBe(true);
    expect(journals[0].startedAt.getTime()).toBeLessThan(journals[1].startedAt.getTime()); // Ordered by startedAt asc
  });
});
