/**
 * PRODUCT-LU-PROJECT-CONTEXT-BOOTSTRAP-01 Phase B.
 *
 * `createOrGetAdminProject` (server/modules/search/adapters/searchRepository.ts) is keyed by
 * `(organisationId, propertyDesignation, status: 'ACTIVE')` -- it assumes one active project per
 * property and silently reuses an existing one rather than creating a new localization. That is
 * the correct semantic for the legacy admin flow it serves, but it is NOT the semantic for
 * property-first LU: the same property must be able to carry many independent localizations
 * (`ORSA STACKMORA 3:12` → "Localization A", "Localization B", "Expansion 2027", ...).
 *
 * This module is the property-first replacement: `listProjectsForProperty` is pure discovery
 * (every project for a property, any status), and `createLocalizationProject` always inserts a
 * new `Project` row -- it never deduplicates or reuses an existing one by designation.
 * `createOrGetAdminProject` is left untouched for whatever legacy admin flows still depend on its
 * get-or-create behaviour.
 */
import { prisma } from '../../db/prisma';

export interface LocalizationProjectSummary {
  readonly id: string;
  readonly name: string | null;
  readonly propertyDesignation: string;
  readonly status: string;
  readonly createdAt: Date;
}

/** Read-only. Every project for this property in this organisation, regardless of status. */
export async function listProjectsForProperty(input: {
  readonly organisationId: string;
  readonly propertyDesignation: string;
}): Promise<LocalizationProjectSummary[]> {
  const propertyDesignation = String(input.propertyDesignation || '').trim().toUpperCase();
  if (!propertyDesignation) {
    throw new Error('propertyDesignation is required');
  }
  return prisma.project.findMany({
    where: { organisationId: input.organisationId, propertyDesignation },
    orderBy: { createdAt: 'desc' },
    select: { id: true, name: true, propertyDesignation: true, status: true, createdAt: true },
  });
}

/**
 * ALWAYS creates a new `Project` row -- never upserts or reuses an existing one by
 * `propertyDesignation`. The creating user becomes real `ProjectMember{accessRole: OWNER}`
 * (same mechanism `createOrGetAdminProject` already uses), which is what makes them a legitimate
 * subject for the bootstrap worker's policy-bounded issuance later.
 */
export async function createLocalizationProject(input: {
  readonly organisationId: string;
  readonly propertyDesignation: string;
  readonly name: string;
  readonly userId: string;
}): Promise<LocalizationProjectSummary> {
  const name = String(input.name || '').trim();
  const propertyDesignation = String(input.propertyDesignation || '').trim().toUpperCase();
  if (!name) throw new Error('name is required');
  if (!propertyDesignation) throw new Error('propertyDesignation is required');

  const project = await prisma.project.create({
    data: {
      organisationId: input.organisationId,
      name,
      propertyDesignation,
      status: 'ACTIVE',
    },
    select: { id: true, name: true, propertyDesignation: true, status: true, createdAt: true },
  });

  await prisma.projectMember.upsert({
    where: { projectId_userId: { projectId: project.id, userId: input.userId } },
    create: { projectId: project.id, userId: input.userId, accessRole: 'OWNER' },
    update: {},
  });

  return project;
}
