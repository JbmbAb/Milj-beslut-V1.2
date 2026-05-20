import { prisma } from '../db/prisma';

export async function createTransportBooking(data: {
  quoteId: string;
  provider: string;
  status: string;
  receiverId: string;
  receiverName: string;
  wasteCode: string;
  tons: number;
  distanceKm: number;
  co2EstimateKg: number;
  plannedPickupAt: Date;
  plannedDeliveryAt: Date;
  externalReference?: string;
}) {
  return prisma.transportBooking.create({
    data,
  });
}

export async function getTransportBooking(id: string) {
  return prisma.transportBooking.findUnique({
    where: { id },
    include: { journals: true, limsReports: true },
  });
}

export async function updateTransportBookingStatus(id: string, status: string) {
  return prisma.transportBooking.update({
    where: { id },
    data: { status, updatedAt: new Date() },
  });
}

export async function createDriverJournal(data: {
  bookingId: string;
  driverName: string;
  vehicleId: string;
  origin: string;
  destination: string;
  wasteCode: string;
  tons: number;
  startedAt: Date;
  endedAt?: Date;
  odometerStartKm: number;
  odometerEndKm?: number;
  gpsTrackHash?: string;
  status: string;
}) {
  return prisma.driverJournal.create({
    data,
  });
}

export async function updateDriverJournal(
  id: string,
  data: Partial<{
    endedAt: Date;
    odometerEndKm: number;
    status: string;
    signedByDriver: boolean;
    signedByReviewer: boolean;
    driverSignatureId: string;
    reviewerSignatureId: string;
  }>,
) {
  return prisma.driverJournal.update({
    where: { id },
    data: { ...data, updatedAt: new Date() },
  });
}

export async function listJournalsForBooking(bookingId: string) {
  return prisma.driverJournal.findMany({
    where: { bookingId },
    orderBy: { startedAt: 'asc' },
  });
}
