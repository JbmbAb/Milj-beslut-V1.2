import { prisma } from "../db/prisma";
import { cleanupExpiredTokenRevocations } from "../repositories/tokenRepository";

/**
 * GDPR Compliance Service
 * Handles data retention policies, user data deletion, and privacy obligations.
 */

/**
 * Marks a user's personal data for retention based on legal hold or auto-expiry.
 * Projects are retained for configured period, then marked for purge.
 */
export async function setProjectRetentionPolicy(
  projectId: string,
  retentionDays: number
): Promise<void> {
  const retentionUntil = new Date();
  retentionUntil.setDate(retentionUntil.getDate() + retentionDays);

  await prisma.project.update({
    where: { id: projectId },
    data: { retentionUntil },
  });
}

/**
 * Soft-delete a user's projects that have exceeded retention period.
 * Marks them as ARCHIVED but doesn't actually delete data yet.
 * Used for compliance audits before permanent deletion.
 */
export async function archiveExpiredProjects(): Promise<number> {
  const now = new Date();

  const result = await prisma.project.updateMany({
    where: {
      status: "CLOSED",
      retentionUntil: {
        lt: now,
      },
    },
    data: {
      status: "ARCHIVED",
    },
  });

  return result.count;
}

/**
 * PERMANENT DELETION: Removes all user data when user account is deleted.
 * This is irreversible and MUST require administrative authorization.
 */
export async function permanentlyDeleteUserData(userId: string): Promise<{
  projectsDeleted: number;
  auditLogsAnonymized: number;
  tokensRevoked: number;
}> {
  // Get user's projects first
  const userProjects = await prisma.projectMember.findMany({
    where: { userId },
    select: { projectId: true },
  });

  const projectIds = userProjects.map((m) => m.projectId);

  // DELETE: All user project memberships
  await prisma.projectMember.deleteMany({
    where: { userId },
  });

  // DELETE: All user access logs (PII)
  await prisma.propertyAccessLog.deleteMany({
    where: { userId },
  });

  // DELETE: All user search queries (PII)
  await prisma.searchQueryLog.deleteMany({
    where: { userId },
  });

  // ANONYMIZE: Audit trail (cannot be deleted for legal reasons)
  const auditLogResult = await prisma.auditTrail.updateMany({
    where: { userId },
    data: { userId: null }, // Anonymize history
  });

  // REVOKE: All user tokens
  const tokenResult = await prisma.tokenRevocation.deleteMany({
    where: { userId },
  });

  // DELETE: User account
  await prisma.user.delete({
    where: { id: userId },
  });

  return {
    projectsDeleted: projectIds.length,
    auditLogsAnonymized: auditLogResult.count,
    tokensRevoked: tokenResult.count,
  };
}

/**
 * Export user's personal data in machine-readable format (GDPR Article 20).
 */
export async function exportUserPersonalData(userId: string): Promise<{
  user: any;
  projects: any[];
  accessLogs: any[];
  searchQueries: any[];
}> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      organisationId: true,
      bankidId: true, // Include eID for transparency
      role: true,
      createdAt: true,
    },
  });

  if (!user) {
    throw new Error("User not found");
  }

  const projects = await prisma.projectMember.findMany({
    where: { userId },
    include: {
      project: {
        select: {
          id: true,
          propertyDesignation: true,
          status: true,
          createdAt: true,
        },
      },
    },
  });

  const accessLogs = await prisma.propertyAccessLog.findMany({
    where: { userId },
    select: {
      id: true,
      propertyDesignation: true,
      purpose: true,
      timestamp: true,
      responseClass: true,
    },
  });

  const searchQueries = await prisma.searchQueryLog.findMany({
    where: { userId },
    select: {
      id: true,
      query: true,
      resultCount: true,
      createdAt: true,
    },
  });

  return {
    user,
    projects,
    accessLogs,
    searchQueries,
  };
}

/**
 * Periodic maintenance: cleanup expired tokens and old logs.
 */
export async function runGdprMaintenanceJob(): Promise<{
  tokensCleanedUp: number;
  projectsArchived: number;
}> {
  const tokensCleanedUp = await cleanupExpiredTokenRevocations();
  const projectsArchived = await archiveExpiredProjects();

  return {
    tokensCleanedUp,
    projectsArchived,
  };
}
