import { prisma } from '../../../db/prisma';

export async function countProjectsForOrganisation(organisationId: string): Promise<number> {
  return prisma.project.count({ where: { organisationId } });
}

export async function listProjectsPageForOrganisation(input: {
  organisationId: string;
  skip: number;
  take: number;
}): Promise<
  Array<{
    id: string;
    propertyDesignation: string;
    status: import('@prisma/client').ProjectStatus;
    createdAt: Date;
    closedAt: Date | null;
    complianceScore: number | null;
    environmentalScore: number | null;
    regulatoryRiskScore: number | null;
    fundingRating: string | null;
  }>
> {
  return prisma.project.findMany({
    where: { organisationId: input.organisationId },
    select: {
      id: true,
      propertyDesignation: true,
      status: true,
      createdAt: true,
      closedAt: true,
      complianceScore: true,
      environmentalScore: true,
      regulatoryRiskScore: true,
      fundingRating: true,
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    skip: input.skip,
    take: input.take,
  });
}

export async function countTransportBookings(): Promise<number> {
  return prisma.transportBooking.count();
}

export async function listTransportBookingsPage(input: { skip: number; take: number }) {
  return prisma.transportBooking.findMany({
    select: {
      id: true,
      status: true,
      receiverName: true,
      wasteCode: true,
      tons: true,
      distanceKm: true,
      co2EstimateKg: true,
      plannedPickupAt: true,
      plannedDeliveryAt: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    skip: input.skip,
    take: input.take,
  });
}
