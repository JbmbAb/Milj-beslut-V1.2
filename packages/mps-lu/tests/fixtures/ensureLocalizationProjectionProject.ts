import { prisma } from "../../../../server/db/prisma";

/**
 * Establishes the relational product state required by the real, FK-backed
 * localization geometry projection. Authority remains in the signed CAS fixture;
 * this only mirrors the ordinary product project's persisted owner/membership state.
 */
export async function ensureLocalizationProjectionProject(args: {
  readonly projectId: string;
  readonly propertyDesignation: string;
}): Promise<void> {
  const suffix = args.projectId.replace(/[^a-z0-9]/gi, "-").toLowerCase();
  const organisation = await prisma.organisation.upsert({
    where: { orgNumber: `test-lu-projection-${suffix}` },
    create: {
      name: `LU projection fixture ${args.projectId}`,
      orgNumber: `test-lu-projection-${suffix}`,
      role: "CLIENT",
    },
    update: {},
  });
  const user = await prisma.user.upsert({
    where: { bankidId: `test-lu-projection-owner-${suffix}` },
    create: {
      bankidId: `test-lu-projection-owner-${suffix}`,
      organisationId: organisation.id,
      role: "CONSULTANT",
    },
    update: { organisationId: organisation.id },
  });

  await prisma.project.upsert({
    where: { id: args.projectId },
    create: {
      id: args.projectId,
      organisationId: organisation.id,
      name: `LU projection fixture ${args.projectId}`,
      propertyDesignation: args.propertyDesignation,
      status: "ACTIVE",
    },
    update: {
      organisationId: organisation.id,
      propertyDesignation: args.propertyDesignation,
      status: "ACTIVE",
    },
  });
  await prisma.projectMember.upsert({
    where: { projectId_userId: { projectId: args.projectId, userId: user.id } },
    create: { projectId: args.projectId, userId: user.id, accessRole: "OWNER" },
    update: { accessRole: "OWNER" },
  });
}
