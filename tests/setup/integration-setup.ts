import { PrismaClient } from '@prisma/client';
import supertest from 'supertest';
import { createApp } from '../../server/createApp';
import { TestDataFactory } from '../integration/test-data-factory';

export const prisma = new PrismaClient();
export const app = createApp();
export const request = supertest(app);
export const factory = new TestDataFactory(prisma);

/**
 * Resets the database to a clean state.
 * Deletes data from all tables that are modified during tests.
 * The order of deletion is crucial to avoid foreign key constraint violations.
 */
export async function resetDatabase() {
  // Start from models with no dependencies on others
  await prisma.requirementCitation.deleteMany();
  await prisma.requirementRecord.deleteMany();
  await prisma.requirementCase.deleteMany();
  await prisma.extractedRequirement.deleteMany();
  await prisma.outlookAttachment.deleteMany();
  await prisma.emailMessage.deleteMany();
  await prisma.pipelineRun.deleteMany();
  await prisma.documentChunk.deleteMany();
  await prisma.documentContent.deleteMany();
  await prisma.documentRecord.deleteMany();
  await prisma.projectMember.deleteMany();
  await prisma.searchQueryLog.deleteMany();
  await prisma.project.deleteMany();

  // These are less frequently created in tests but good to clean up
  await prisma.satelliteAnalysis.deleteMany();
  await prisma.satelliteScene.deleteMany();

  // Finally, users and organisations, but keep the admin user/org
  const adminUser = await prisma.user.findFirst({ where: { role: 'ADMIN' } });
  if (adminUser) {
    await prisma.user.deleteMany({
      where: { id: { not: adminUser.id } },
    });
    await prisma.organisation.deleteMany({
      where: { id: { not: adminUser.organisationId } },
    });
  } else {
    // If no admin user, clean everything
    await prisma.user.deleteMany();
    await prisma.organisation.deleteMany();
  }
}
