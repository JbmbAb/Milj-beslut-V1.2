import { prisma } from '../../../db/prisma';

export async function getExportManifest(input: {
  exportId: string;
  organisationId: string;
}): Promise<Record<string, unknown>> {
  const exportId = String(input.exportId || '').trim();
  if (!exportId) throw new Error('exportId required');

  const row = await prisma.evidenceExport.findFirst({
    where: { id: exportId, organisationId: input.organisationId },
    select: { manifest: true },
  });
  if (!row) throw new Error('Export not found');
  return (row.manifest ?? {}) as Record<string, unknown>;
}
