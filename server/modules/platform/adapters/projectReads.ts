import { prisma } from '../../../db/prisma';

export async function getProjectForPlanHeader(projectId: string) {
  return prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      propertyDesignation: true,
      status: true,
      createdAt: true,
    },
  });
}

export async function getProjectForCarbonView(projectId: string) {
  return prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      propertyDesignation: true,
      environmentalScore: true,
      complianceScore: true,
      regulatoryRiskScore: true,
    },
  });
}

export async function getProjectEnvironmentalOnly(projectId: string) {
  return prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      environmentalScore: true,
    },
  });
}
