import { Prisma, PrismaClient } from '../db/prisma';
import { cleanupExpiredTokenRevocations } from '../repositories/tokenRepository';
import { deleteStorageFile } from './documentObjectStorage';

/**
 * GDPR Compliance Service
 * Handles data retention policies, user data deletion, and privacy obligations.
 */

/**
 * Marks a user's personal data for retention based on legal hold or auto-expiry.
 * Projects are retained for configured period, then marked for purge.
 */
export async function setProjectRetentionPolicy(projectId: string, retentionDays: number): Promise<void> {
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
      status: 'CLOSED',
      retentionUntil: {
        lt: now,
      },
    },
    data: {
      status: 'ARCHIVED',
    },
  });

  return result.count;
}

/**
 * PERMANENT DELETION: Removes all project data when retention period expires.
 */
export async function permanentlyDeleteProjectData(
  projectId: string,
  prismaClient?: Prisma.TransactionClient,
): Promise<void> {
  const db = prismaClient ?? prisma;

  await db.$transaction(async (tx) => {
    const project = await tx.project.findUnique({
      where: { id: projectId },
      include: {
        documents: {
          select: { id: true, absolutePath: true },
        },
      },
    });

    if (!project) return;

    // 1. Delete all requirement related data
    await tx.requirementCitation.deleteMany({
      where: { case: { projectId } },
    });
    await tx.requirementRecord.deleteMany({
      where: { projectId },
    });
    await tx.requirementCase.deleteMany({
      where: { projectId },
    });

    // 2. Delete document content and chunks
    for (const doc of project.documents) {
      await tx.documentChunk.deleteMany({
        where: { documentId: doc.id },
      });
      await tx.documentContent.deleteMany({
        where: { documentId: doc.id },
      });

      // Try to delete file from disk if absolutePath exists
      if (doc.absolutePath) {
        try {
          await deleteStorageFile(doc.absolutePath); // Use statically imported function
        } catch (e) {
          console.warn(`Failed to delete stored file: ${doc.absolutePath}`, e);
        }
      }
    }

    // 3. Delete document records
    await tx.documentRecord.deleteMany({
      where: { projectId },
    });

    // 4. Delete project plan state
    await tx.projectPlanState.deleteMany({
      where: { projectId },
    });

    // 5. Delete project memberships and logs
    await tx.projectMember.deleteMany({
      where: { projectId },
    });
    await tx.propertyAccessLog.deleteMany({
      where: { projectId },
    });
    await tx.searchQueryLog.deleteMany({
      where: { projectId },
    });

    // 6. Finally delete the project itself
    await tx.project.delete({
      where: { id: projectId },
    });
  });

  console.info(`Permanently deleted project data for project: ${projectId}`);
}

/**
 * SCRUBBING: Anonymizes sensitive data instead of deleting records.
 * Replaces PII with placeholders in documents and logs.
 */
export async function scrubProjectData(projectId: string): Promise<void> {
  // This function performs updates and is less critical to be fully atomic,
  // but could be refactored to accept a transaction client in the future if needed.
  const db = prisma;
  const project = await db.project.findUnique({
    where: { id: projectId },
    include: {
      documents: {
        select: { id: true, absolutePath: true },
      },
    },
  });

  if (!project) return;

  const SCRUB_TEXT = '[SCRUBBED]';

  await db.documentContent.updateMany({
    where: { document: { projectId } },
    data: {
      searchText: SCRUB_TEXT,
      contentCiphertext: 'ANONYMIZED',
      contentIv: '000000000000000000000000',
      contentTag: '00000000000000000000000000000000',
    },
  });

  await db.documentChunk.updateMany({
    where: { document: { projectId } },
    data: {
      chunkText: SCRUB_TEXT,
      embeddingJson: undefined as any,
    },
  });

  await db.documentRecord.updateMany({
    where: { projectId },
    data: {
      subject: SCRUB_TEXT,
      originalName: 'anonymized_document.pdf',
      manifestMeta: undefined as any,
      fieldExtractorVersion: undefined as any,
    },
  });

  // Anonymize requirement texts and citations which may contain PII from documents
  await db.requirementRecord.updateMany({
    where: { projectId },
    data: {
      requirementTextQuote: SCRUB_TEXT,
      interpretedRequirement: SCRUB_TEXT,
      comment: SCRUB_TEXT,
    },
  });

  await db.requirementCitation.updateMany({
    where: { case: { projectId } },
    data: {
      quoteText: SCRUB_TEXT,
    },
  });

  // Anonymize case notes which might contain sensitive discussion
  await db.caseNote.updateMany({
    where: { case: { projectId } },
    data: { text: SCRUB_TEXT, author: 'anonymized' },
  });

  await db.propertyAccessLog.updateMany({
    where: { projectId },
    data: {
      purpose: SCRUB_TEXT,
      propertyDesignation: 'REDACTED',
    },
  });

  await db.searchQueryLog.updateMany({
    where: { projectId },
    data: {
      query: SCRUB_TEXT,
    },
  });

  for (const doc of project.documents) {
    if (doc.absolutePath) {
      try {
        await deleteStorageFile(doc.absolutePath); // Use statically imported function
      } catch (e) {
        console.warn(`Failed to delete stored file during scrubbing: ${doc.absolutePath}`, e);
      }
    }
  }

  await db.project.update({
    where: { id: projectId },
    data: {
      propertyDesignation: 'SCRUBBED_PROJECT',
      status: 'ARCHIVED',
    },
  });
}

/**
 * PERMANENT DELETION: Removes all user data when user account is deleted.
 */
export async function permanentlyDeleteUserData(userId: string): Promise<{
  projectsDeleted: number;
  auditLogsAnonymized: number;
  tokensRevoked: number;
}> {
  return prisma.$transaction(async (tx) => {
    // STEG 1: Hämta alla projekt som användaren äger.
    const ownedProjects = await tx.projectMember.findMany({
      where: { userId, accessRole: 'OWNER' },
      select: { projectId: true },
    });

    // STEG 2: Radera alla projekt som användaren äger permanent.
    for (const membership of ownedProjects) {
      // Pass the transaction client `tx` to the project deletion function.
      await permanentlyDeleteProjectData(membership.projectId, tx);
    }

    // STEG 3: Radera alla projektmedlemskap för användaren.
    await tx.projectMember.deleteMany({ where: { userId } });

    // STEG 4: Radera all personidentifierbar information (PII) i loggar.
    await tx.propertyAccessLog.deleteMany({ where: { userId } });
    await tx.searchQueryLog.deleteMany({ where: { userId } });

    // STEG 5: Anonymisera audit trail.
    const auditLogsAnonymized = await tx.auditTrail.updateMany({
      where: { userId },
      data: { userId: null },
    });

    // STEG 6: Återkalla alla inloggningstokens.
    const tokensRevoked = await tx.tokenRevocation.deleteMany({
      where: { userId },
    });

    // STEG 7: Radera själva användarkontot.
    await tx.user.delete({
      where: { id: userId },
    });

    return {
      projectsDeleted: ownedProjects.length,
      auditLogsAnonymized: auditLogsAnonymized.count,
      tokensRevoked: tokensRevoked.count,
    };
  });
}

/**
 * Export user's personal data in machine-readable format (GDPR Article 20).
 */
export async function getUserDataExport(userId: string): Promise<{
  user: any;
  projects: any[];
  accessLogs: any[];
  searchQueries: any[];
  caseNotes: any[];
}> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      organisationId: true,
      bankidId: true,
      role: true,
      createdAt: true,
    },
  });

  if (!user) {
    throw new Error('User not found');
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

  const caseNotes = await prisma.caseNote.findMany({
    where: { author: user.id },
    select: { id: true, caseId: true, text: true, createdAt: true },
  });

  return {
    user,
    projects,
    accessLogs,
    searchQueries,
    caseNotes,
  };
}

/**
 * Periodic maintenance: cleanup expired tokens and old logs.
 */
export async function runGdprMaintenanceJob(): Promise<{
  tokensCleanedUp: number;
  projectsArchived: number;
  projectsPurged: number;
}> {
  const tokensCleanedUp = await cleanupExpiredTokenRevocations();
  const projectsArchived = await archiveExpiredProjects();

  const purgeThreshold = new Date();
  purgeThreshold.setDate(purgeThreshold.getDate() - 30);

  const projectsToPurge = await prisma.project.findMany({
    where: {
      status: 'ARCHIVED',
      retentionUntil: {
        lt: purgeThreshold,
      },
    },
    select: { id: true },
  });

  for (const project of projectsToPurge) {
    await permanentlyDeleteProjectData(project.id, prisma);
  }

  return {
    tokensCleanedUp,
    projectsArchived,
    projectsPurged: projectsToPurge.length,
  };
}
