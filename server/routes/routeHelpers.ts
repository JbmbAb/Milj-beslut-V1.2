import { prisma } from '../db/prisma';
import { AppModuleAccess, AppBootstrapProjectSummary } from '../../types';

export const WORKSPACE_MODULES: Array<{
  id: AppModuleAccess['id'];
  title: string;
  description: string;
  requiresProject: boolean;
  adminOnly?: boolean;
}> = [
  { id: 'core', title: 'Ärendeportal', description: 'Projekt, sök, klassificering.', requiresProject: true },
  { id: 'ansokan', title: 'Ansökningsportal', description: 'Tillståndsarbete.', requiresProject: true },
  { id: 'logistik', title: 'Logistik och massor', description: 'Transport, mottagning.', requiresProject: true },
  { id: 'projekt', title: 'Projektledning', description: 'Plan, gates, dokument.', requiresProject: true },
  { id: 'gronkoll', title: 'Compliance och score', description: 'Verifierad compliance.', requiresProject: true },
  { id: 'admin', title: 'Administratör', description: 'Systemvy.', requiresProject: false, adminOnly: true },
];

export function summarizeModuleAccess(input: {
  activeProjectId: string | null;
  projectCount: number;
  role: string;
}): AppModuleAccess[] {
  return WORKSPACE_MODULES.map((module) => {
    const adminBlocked = Boolean(module.adminOnly && input.role !== 'ADMIN');
    const projectBlocked = Boolean(module.requiresProject && !input.activeProjectId);
    const enabled = !adminBlocked && !projectBlocked;

    let status: AppModuleAccess['status'] = 'ready';
    let reason = input.projectCount === 0 ? 'Inga projekt tillgängliga.' : 'Klar att öppna.';

    if (adminBlocked) {
      status = 'unavailable';
      reason = 'Adminbehörighet krävs.';
    } else if (projectBlocked) {
      status = input.projectCount > 0 ? 'empty' : 'unavailable';
      reason = 'Välj ett aktivt projekt.';
    }

    return {
      id: module.id,
      title: module.title,
      description: module.description,
      enabled,
      status,
      reason,
      projectCount: input.projectCount,
    };
  });
}

export async function listAccessibleProjects(input: {
  userId: string;
  organisationId: string;
  role: string;
}): Promise<AppBootstrapProjectSummary[]> {
  const where = {
    organisationId: input.organisationId,
    members: { some: { userId: input.userId } },
  };

  const projects = await prisma.project.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }],
    select: {
      id: true,
      propertyDesignation: true,
      status: true,
      createdAt: true,
      complianceScore: true,
      environmentalScore: true,
      fundingRating: true,
      regulatoryRiskScore: true,
      planState: { select: { updatedAt: true } },
      _count: { select: { documents: true, members: true } },
    },
  });

  return projects.map((p) => ({
    id: p.id,
    propertyDesignation: p.propertyDesignation,
    status: p.status as any,
    createdAt: p.createdAt.toISOString(),
    complianceScore: p.complianceScore,
    environmentalScore: p.environmentalScore,
    fundingRating: p.fundingRating,
    regulatoryRiskScore: p.regulatoryRiskScore,
    documentCount: p._count.documents,
    memberCount: p._count.members,
    lastPlanUpdatedAt: p.planState?.updatedAt?.toISOString() || null,
  }));
}

export function parseOptionalText(value: unknown): string | undefined {
  const text = String(value ?? '').trim();
  return text || undefined;
}
