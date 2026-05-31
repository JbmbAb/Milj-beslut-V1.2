import { test, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { UserRole } from '@prisma/client';
import { createTokenPair } from '../../server/security/auth';
import { prisma, request, factory, resetDatabase } from '../setup/integration-setup';

let testUser: { id: string; organisationId: string; token: string };
let adminToken: string;

async function setupTestUser() {
  // Create a standard user for testing self-service actions
  const org = await prisma.organisation.create({
    data: { name: 'GDPR Test Org', orgNumber: `gdpr-test-${Date.now()}` },
  });

  const user = await prisma.user.create({
    data: {
      bankidId: `gdpr-user-${Date.now()}`,
      role: UserRole.CONSULTANT,
      organisationId: org.id,
    },
  });

  const tokenPair = createTokenPair(user);

  testUser = {
    id: user.id,
    organisationId: org.id,
    token: tokenPair.accessToken,
  };
}

beforeAll(async () => {
  const adminOrg = await prisma.organisation.upsert({
    where: { orgNumber: 'admin-org-001' },
    create: { name: 'Admin Org', orgNumber: 'admin-org-001' },
    update: { name: 'Admin Org' },
  });
  const adminUser = await prisma.user.upsert({
    where: { bankidId: 'admin-test-id' },
    create: {
      bankidId: 'admin-test-id',
      role: UserRole.ADMIN,
      organisationId: adminOrg.id,
    },
    update: { organisationId: adminOrg.id, role: UserRole.ADMIN },
  });
  const tokenPair = createTokenPair(adminUser);
  adminToken = tokenPair.accessToken;
});

beforeEach(async () => {
  await resetDatabase();
  await setupTestUser();
});

afterAll(async () => {
  await prisma.$disconnect();
});

test('GET /api/gdpr/me/export should return all data for the authenticated user', async () => {
  // 1. Arrange: Create data associated with the user
  const project = await factory.createProject(testUser.organisationId);

  await prisma.projectMember.create({
    data: {
      projectId: project.id,
      userId: testUser.id,
      accessRole: 'OWNER',
    },
  });

  await prisma.searchQueryLog.create({
    data: {
      userId: testUser.id,
      projectId: project.id,
      query: 'test export query',
      resultCount: 5,
    },
  });

  // 2. Act: Call the export endpoint
  const response = await request.get('/api/gdpr/me/export').set('Authorization', `Bearer ${testUser.token}`);

  // 3. Assert: Check that the response contains the created data
  expect(response.status).toBe(200);
  expect(response.body.ok).toBe(true);
  const exportedData = response.body.data;

  expect(exportedData.user.id).toBe(testUser.id);
  expect(exportedData.projects).toHaveLength(1);
  expect(exportedData.projects[0].project.id).toBe(project.id);
  expect(exportedData.searchQueries).toHaveLength(1);
  expect(exportedData.searchQueries[0].query).toBe('test export query');
});

test('DELETE /api/gdpr/me should permanently delete all data for the authenticated user', async () => {
  // 1. Arrange: Create data associated with the user
  const project = await factory.createProject(testUser.organisationId);

  await prisma.projectMember.create({
    data: {
      projectId: project.id,
      userId: testUser.id,
      accessRole: 'OWNER',
    },
  });

  await prisma.searchQueryLog.create({
    data: {
      userId: testUser.id,
      projectId: project.id,
      query: 'test deletion query',
      resultCount: 5,
    },
  });

  // 2. Act: Call the deletion endpoint
  const response = await request.delete('/api/gdpr/me').set('Authorization', `Bearer ${testUser.token}`);

  // 3. Assert: Check that the response is successful
  expect(response.status).toBe(200);
  expect(response.body.ok).toBe(true);
  expect(response.body.projectsDeleted).toBeGreaterThanOrEqual(1);

  // 4. Verify: Check that the data is gone from the database
  const userCount = await prisma.user.count({ where: { id: testUser.id } });
  expect(userCount).toBe(0);

  const projectCount = await prisma.project.count({ where: { id: project.id } });
  expect(projectCount).toBe(0);

  const queryCount = await prisma.searchQueryLog.count({ where: { userId: testUser.id } });
  expect(queryCount).toBe(0);
});

test('DELETE /api/admin/gdpr/users/:userId should allow an admin to delete another user', async () => {
  // 1. Arrange: Create data associated with the user that the admin will delete.
  const project = await factory.createProject(testUser.organisationId);
  await prisma.projectMember.create({
    data: {
      projectId: project.id,
      userId: testUser.id,
      accessRole: 'OWNER',
    },
  });

  // 2. Act: Admin calls the deletion endpoint for the testUser
  const response = await request
    .delete(`/api/admin/gdpr/users/${testUser.id}`)
    .set('Authorization', `Bearer ${adminToken}`);

  // 3. Assert: Check that the response is successful
  expect(response.status).toBe(200);
  expect(response.body.ok).toBe(true);

  // 4. Verify: Check that the user's data is gone
  const userCount = await prisma.user.count({ where: { id: testUser.id } });
  expect(userCount).toBe(0);
});

test('runGdprMaintenanceJob should archive projects with expired retention policy', async () => {
  const { runGdprMaintenanceJob } = await import('../../server/services/gdprComplianceService');

  // 1. Arrange: Create a project with an expired retention date
  const expiredProject = await prisma.project.create({
    data: {
      organisationId: testUser.organisationId,
      propertyDesignation: 'EXPIRED 1:1',
      status: 'CLOSED',
      retentionUntil: new Date(Date.now() - 24 * 60 * 60 * 1000), // Yesterday
    },
  });

  const activeProject = await prisma.project.create({
    data: {
      organisationId: testUser.organisationId,
      propertyDesignation: 'ACTIVE 2:2',
      status: 'CLOSED',
      retentionUntil: new Date(Date.now() + 24 * 60 * 60 * 1000), // Tomorrow
    },
  });

  // 2. Act: Run maintenance
  const results = await runGdprMaintenanceJob();

  // 3. Assert: Verify the expired project was archived
  expect(results.projectsArchived).toBeGreaterThanOrEqual(1);

  const archivedProject = await prisma.project.findUnique({
    where: { id: expiredProject.id },
  });
  expect(archivedProject?.status).toBe('ARCHIVED');

  const stillClosedProject = await prisma.project.findUnique({
    where: { id: activeProject.id },
  });
  expect(stillClosedProject?.status).toBe('CLOSED');
});

test('runGdprMaintenanceJob should permanently purge archived projects older than 30 days', async () => {
  const { runGdprMaintenanceJob } = await import('../../server/services/gdprComplianceService');

  // 1. Arrange: Create an archived project with a very old retention date
  const oldArchivedProject = await prisma.project.create({
    data: {
      organisationId: testUser.organisationId,
      propertyDesignation: 'PURGE ME 1:1',
      status: 'ARCHIVED',
      retentionUntil: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000), // 40 days ago
    },
  });

  // 2. Act: Run maintenance
  const results = await runGdprMaintenanceJob();

  // 3. Assert: Verify the project was purged
  expect(results.projectsPurged).toBeGreaterThanOrEqual(1);

  const purgedProject = await prisma.project.findUnique({
    where: { id: oldArchivedProject.id },
  });
  expect(purgedProject).toBeNull();
});

test('scrubProjectData should anonymize all sensitive data within a project', async () => {
  const { scrubProjectData } = await import('../../server/services/gdprComplianceService');

  // 1. Arrange: Create a project with all related sensitive data types
  const project = await factory.createProject(testUser.organisationId, {
    propertyDesignation: 'PROJECT_TO_SCRUB 1:1',
  });
  const doc = await factory.createDocument(project.id, testUser.organisationId);
  await prisma.documentContent.create({
    data: {
      documentId: doc.id,
      searchText: 'Sensitive content to be scrubbed.',
      contentCiphertext: 'encrypted',
      contentIv: 'iv',
      contentTag: 'tag',
    },
  });
  const reqCase = await factory.createRequirementCase(project.id, doc.id, testUser.organisationId);
  const requirement = await factory.createRequirement(reqCase.id, doc.id, project.id, {
    requirementTextQuote: 'A quote with PII.',
    interpretedRequirement: 'An interpretation with names.',
  });
  await prisma.caseNote.create({
    data: {
      caseId: reqCase.id,
      text: 'A sensitive note about the case.',
      author: testUser.id,
    },
  });

  // 2. Act: Run the scrubbing function
  await scrubProjectData(project.id);

  // 3. Assert: Verify that all data has been anonymized
  const scrubbedProject = await prisma.project.findUnique({ where: { id: project.id } });
  expect(scrubbedProject?.propertyDesignation).toBe('SCRUBBED_PROJECT');

  const scrubbedContent = await prisma.documentContent.findFirst({ where: { documentId: doc.id } });
  expect(scrubbedContent?.searchText).toBe('[SCRUBBED]');
  expect(scrubbedContent?.contentCiphertext).toBe('ANONYMIZED');

  const scrubbedRequirement = await prisma.requirementRecord.findUnique({ where: { id: requirement.id } });
  expect(scrubbedRequirement?.requirementTextQuote).toBe('[SCRUBBED]');
  expect(scrubbedRequirement?.interpretedRequirement).toBe('[SCRUBBED]');

  const scrubbedNote = await prisma.caseNote.findFirst({ where: { caseId: reqCase.id } });
  expect(scrubbedNote?.text).toBe('[SCRUBBED]');
  expect(scrubbedNote?.author).toBe('anonymized');
});
