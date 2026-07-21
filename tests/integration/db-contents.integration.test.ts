import { test, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { DocumentProcessingStatus } from '@prisma/client';
import { prisma, request, factory, resetDatabase } from '../setup/integration-setup';

let adminToken: string;

beforeAll(async () => {
  // Perform a real login to get a valid token
  const loginRes = await request.post('/api/admin/auth/login').send({
    username: process.env.ADMIN_CONSOLE_USERNAME || 'admin',
    password: process.env.ADMIN_CONSOLE_PASSWORD || 'admin',
  });
  adminToken = loginRes.body.accessToken;
});

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

test('GET /api/admin/db-contents should return rows from key tables', async () => {
  // 1. Arrange: Create one of each entity type the endpoint is expected to return.
  const org = await factory.createOrganisation({ id: 'org-contents-1' });
  const project = await factory.createProject(org.id, { id: 'proj-contents-1' });

  const doc = await factory.createDocument(project.id, org.id, {
    id: 'doc-contents-1',
    status: DocumentProcessingStatus.EMBEDDED,
  });

  const reqCase = await prisma.requirementCase.create({
    data: {
      id: 'case-contents-1',
      caseKey: 'CASE-CONTENTS-KEY',
      documentId: doc.id,
      projectId: project.id,
      organisationId: org.id,
      sourceFile: 'doc.pdf',
    },
  });

  const req = await prisma.requirementRecord.create({
    data: {
      id: 'req-contents-1',
      requirementCode: 'REQ-CONTENTS-CODE',
      caseId: reqCase.id,
      sourceType: 'MANUAL',
      documentId: doc.id,
      projectId: project.id,
      requirementTextQuote: 'text',
      interpretedRequirement: 'text',
      category: 'Förvaring',
      subcategory: 'Invallning',
      level: 'mandatory',
      codingConfidence: 'MEDIUM',
      statusInNotification: 'Gäller',
      minimumRequirement: false,
    },
  });

  const run = await prisma.pipelineRun.create({
    data: {
      runId: 'run-contents-1',
      status: 'COMPLETED',
      runType: 'OUTLOOK_INGESTION',
      processedCount: 1,
    },
  });

  const email = await prisma.emailMessage.create({
    data: {
      messageId: 'email-contents-1',
      sender: 'test@example.com',
      subject: 'Email for contents test',
      status: 'COMPLETE',
      runId: run.runId,
    },
  });

  const attachment = await prisma.outlookAttachment.create({
    data: {
      attachmentHash: 'hash-contents-1',
      filename: 'attach.pdf',
      filesize: 100n,
      checksumSha256: 'sha256-hash-1',
      canonicalMessage: {
        connect: { messageId: email.messageId },
      },
    },
  });

  const extractedReq = await prisma.extractedRequirement.create({
    data: {
      id: 'ext-req-contents-1',
      attachmentHash: attachment.attachmentHash,
      requirementText: 'text',
      category: 'Dagvatten',
      requirementLevel: 'mandatory',
      confidence: 0.85,
    },
  });

  // 2. Act: Call the API endpoint
  const response = await request.get('/api/admin/db-contents').set('Authorization', `Bearer ${adminToken}`);

  // 3. Assert: Check that the response contains the data we just created
  expect(response.status).toBe(200);
  const contents = response.body.contents;

  expect(contents.organisations.rows[0].id).toBe(org.id);
  expect(contents.projects.rows[0].id).toBe(project.id);
  expect(contents.documents.rows[0].id).toBe(doc.id);
  expect(contents.requirementCases.rows[0].id).toBe(reqCase.id);
  expect(contents.requirements.rows[0].id).toBe(req.id);
  expect(contents.pipelineRuns.rows[0].id).toBe(run.runId);
  expect(contents.emailMessages.rows[0].messageId).toBe(email.messageId);
  expect(contents.extractedRequirements.rows[0].id).toBe(extractedReq.id);
});
