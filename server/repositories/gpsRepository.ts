import { prisma } from '../db/prisma';

export async function addGpsPosition(data: {
  bookingId: string;
  lat: number;
  lng: number;
  altitude?: number;
  speedKmh?: number;
  heading?: number;
  accuracy?: number;
  hash: string;
  prevHash?: string | null;
}) {
  return prisma.gpsPosition.create({
    data: {
      ...data,
      timestamp: new Date(),
    },
  });
}

export async function getGpsTrack(bookingId: string) {
  return prisma.gpsPosition.findMany({
    where: { bookingId },
    orderBy: { timestamp: 'asc' },
  });
}

export async function getLatestPosition(bookingId: string) {
  return prisma.gpsPosition.findFirst({
    where: { bookingId },
    orderBy: { timestamp: 'desc' },
  });
}

export async function clearGpsTrack(bookingId: string) {
  return prisma.gpsPosition.deleteMany({
    where: { bookingId },
  });
}
