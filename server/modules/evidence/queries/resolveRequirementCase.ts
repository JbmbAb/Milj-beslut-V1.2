import { prisma } from '../../../db/prisma';

/**
 * Picks a stable requirement case for a project (latest activity) when submission does not carry one.
 */
export async function resolveRequirementCaseIdForProject(input: {
  projectId: string;
  organisationId: string;
}): Promise<string | null> {
  const row = await prisma.requirementCase.findFirst({
    where: { projectId: input.projectId, organisationId: input.organisationId },
    orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
    select: { id: true },
  });
  return row?.id ?? null;
}

export async function countEvidenceExportsForCase(requirementCaseId: string): Promise<number> {
  return prisma.evidenceExport.count({ where: { requirementCaseId } });
}

/**
 * Använd lagrat case-id bara om det pekar på rätt projekt+org; annars lös via projektet.
 */
export async function resolveRequirementCaseIdForSubmission(input: {
  requirementCaseId: string | null | undefined;
  projectId: string;
  organisationId: string;
}): Promise<string | null> {
  const raw = String(input.requirementCaseId || '').trim();
  if (raw) {
    const row = await prisma.requirementCase.findFirst({
      where: { id: raw, projectId: input.projectId, organisationId: input.organisationId },
      select: { id: true },
    });
    if (row) return row.id;
  }
  return resolveRequirementCaseIdForProject({
    projectId: input.projectId,
    organisationId: input.organisationId,
  });
}
