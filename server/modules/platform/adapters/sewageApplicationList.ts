import { prisma } from '../../../db/prisma';

export async function countAllProjects(): Promise<number> {
  return prisma.project.count();
}

export async function listProjectsSewagePage(input: { skip: number; take: number }) {
  return prisma.project.findMany({
    select: {
      id: true,
      propertyDesignation: true,
      status: true,
      createdAt: true,
      environmentalScore: true,
    },
    orderBy: { createdAt: 'desc' },
    skip: input.skip,
    take: input.take,
  });
}

export async function getProjectBasicForSewage(id: string) {
  return prisma.project.findUnique({
    where: { id },
    select: {
      id: true,
      propertyDesignation: true,
      status: true,
      createdAt: true,
    },
  });
}
