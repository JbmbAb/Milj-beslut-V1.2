import { prisma } from '../db/prisma';

export async function createLimsReport(data: {
  bookingId?: string | null;
  sampleId: string;
  labName: string;
  source: string;
  analyzedAt: Date;
  rawReference: string;
  metrics: any;
  passed: boolean;
}) {
  return prisma.limsReport.create({
    data,
  });
}

export async function getLimsReport(id: string) {
  return prisma.limsReport.findUnique({
    where: { id },
  });
}

export async function verifyLimsReport(
  id: string,
  data: {
    reviewer: string;
    reviewerSignatureId: string;
    verifiedAt: Date;
    passed: boolean;
  },
) {
  return prisma.limsReport.update({
    where: { id },
    data: {
      ...data,
      verifiedByHuman: true,
    },
  });
}

export async function listLimsReportsBySample(sampleId: string) {
  return prisma.limsReport.findMany({
    where: { sampleId },
    orderBy: { createdAt: 'desc' },
  });
}

export async function listLimsReportsByBooking(bookingId: string) {
  return prisma.limsReport.findMany({
    where: { bookingId },
    orderBy: { createdAt: 'desc' },
  });
}
