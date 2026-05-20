import { prisma } from '../../../db/prisma';

export async function listDocumentIdsForProject(input: {
  projectId: string;
  organisationId: string;
  take?: number;
}): Promise<string[]> {
  const docs = await prisma.documentRecord.findMany({
    where: { projectId: input.projectId, organisationId: input.organisationId },
    select: { id: true },
    take: input.take ?? 5000,
  });
  return docs.map((d) => d.id);
}
