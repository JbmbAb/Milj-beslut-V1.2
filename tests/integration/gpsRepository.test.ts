import { prisma } from '../../server/db/prisma';
import { it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

import {
  addGpsPosition,
  getGpsTrack,
  getLatestPosition,
  clearGpsTrack,
} from '../../server/repositories/gpsRepository';
import { describeIfDatabaseIntegration } from './integrationTestEnv';



describeIfDatabaseIntegration('gpsRepository Integration', () => {
  let testBookingId: string;

  beforeAll(async () => {
    await prisma.$connect();
    // Create a dummy TransportBooking to satisfy foreign key constraint for GpsPosition
    const booking = await prisma.transportBooking.create({
      data: {
        quoteId: 'quote-gps-test',
        provider: 'MOCK_FRAKTBORS',
        status: 'BOOKED',
        receiverId: 'receiver-gps-test',
        receiverName: 'GPS Test Receiver',
        wasteCode: '17 05 04',
        tons: 10,
        distanceKm: 50,
        co2EstimateKg: 100,
        plannedPickupAt: new Date(),
        plannedDeliveryAt: new Date(Date.now() + 3600 * 1000),
      },
    });
    testBookingId = booking.id;
  });

  afterAll(async () => {
    // Clean up the dummy TransportBooking
    await prisma.transportBooking.delete({ where: { id: testBookingId } });
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    // Clear all GPS positions for the test booking before each test
    await prisma.gpsPosition.deleteMany({ where: { bookingId: testBookingId } });
  });

  it('should add a GPS position', async () => {
    const positionData = {
      bookingId: testBookingId,
      lat: 59.3293,
      lng: 18.0686,
      hash: 'hash1',
    };
    const createdPosition = await addGpsPosition(positionData);
    expect(createdPosition).toBeDefined();
    expect(createdPosition.id).toBeDefined();
    expect(createdPosition.lat).toBe(positionData.lat);
    expect(createdPosition.lng).toBe(positionData.lng);
  });

  it('should retrieve a GPS track', async () => {
    await addGpsPosition({ bookingId: testBookingId, lat: 59.0, lng: 18.0, hash: 'hashA' });
    await addGpsPosition({
      bookingId: testBookingId,
      lat: 59.1,
      lng: 18.1,
      hash: 'hashB',
      prevHash: 'hashA',
    });

    const track = await getGpsTrack(testBookingId);
    expect(track.length).toBe(2);
    expect(track[0].lat).toBe(59.0); // Ordered by timestamp asc
    expect(track[1].lat).toBe(59.1);
  });

  it('should retrieve the latest GPS position', async () => {
    await addGpsPosition({ bookingId: testBookingId, lat: 59.0, lng: 18.0, hash: 'hashX' });
    await addGpsPosition({
      bookingId: testBookingId,
      lat: 59.2,
      lng: 18.2,
      hash: 'hashY',
      prevHash: 'hashX',
    });

    const latest = await getLatestPosition(testBookingId);
    expect(latest).toBeDefined();
    expect(latest?.lat).toBe(59.2);
  });

  it('should clear a GPS track', async () => {
    await addGpsPosition({ bookingId: testBookingId, lat: 59.0, lng: 18.0, hash: 'hashZ' });
    const deletedCount = await clearGpsTrack(testBookingId);
    expect(deletedCount).toBe(1);
    const track = await getGpsTrack(testBookingId);
    expect(track.length).toBe(0);
  });
});
