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

test('GET /api/admin/db-analysis should return correct analysis from the database', async () => {
  // 1. Arrange: Create more detailed data for analysis
  const org = await factory.createOrganisation({ id: 'org-analysis-1' });
  const project = await factory.createProject(org.id, { id: 'proj-analysis-1' });

  const doc1 = await factory.createDocument(project.id, org.id, {
    status: DocumentProcessingStatus.EMBEDDED,
    decisionType: 'BIFALL',
    legalStatus: 'VUNNIT_LAGA_KRAFT',
    municipality: 'Stockholm',
    municipalityConfidence: 0.95,
  });
  await factory.createDocument(project.id, org.id, {
    status: DocumentProcessingStatus.METADATA_ONLY,
    decisionType: 'AVSLAG',
    municipality: 'Stockholm',
    municipalityConfidence: 0.45,
  });

  // A document without any requirements to test coverage gap
  await factory.createDocument(project.id, org.id, {
    status: DocumentProcessingStatus.EMBEDDED,
    decisionType: 'BIFALL',
    municipality: 'Göteborg',
    municipalityNormalized: 'Göteborg',
  });

  const case1 = await prisma.requirementCase.create({
    data: {
      caseKey: 'case-key-analysis-1',
      sourceFile: 'doc1.pdf',
      documentId: doc1.id,
      organisationId: org.id,
      projectId: project.id,
      municipality: 'Stockholm',
    },
  });

  const req1 = await prisma.requirementRecord.create({
    data: {
      caseId: case1.id,
      documentId: doc1.id,
      projectId: project.id,
      requirementCode: 'req-code-analysis-1',
      sourceType: 'MANUAL',
      requirementTextQuote: 'text',
      interpretedRequirement: 'text',
      category: 'Buller',
      subcategory: 'Allmänt',
      level: 'mandatory',
      codingConfidence: 'HIGH',
      statusInNotification: 'Gäller',
      municipalitySpecific: true,
      minimumRequirement: true,
    },
  });

  await prisma.requirementCitation.create({
    data: {
      citationCode: 'cit-code-analysis-1',
      requirementId: req1.id,
      caseId: case1.id,
      documentId: doc1.id,
      quoteText: 'Buller från verksamheten får inte överstiga...',
    },
  });

  // 2. Act: Call the API endpoint
  const response = await request.get('/api/admin/db-analysis').set('Authorization', `Bearer ${adminToken}`);

  // 3. Assert: Check that the analysis reflects the created data
  expect(response.status).toBe(200);
  const analysis = response.body.analysis;

  // Assert on requirements analysis
  expect(analysis.requirements.byCategory).toEqual(
    expect.arrayContaining([{ category: 'Buller', count: 1 }]),
  );
  expect(analysis.requirements.byCodingConfidence).toEqual(
    expect.arrayContaining([{ confidence: 'HIGH', count: 1 }]),
  );
  expect(analysis.requirements.municipalitySpecificCount).toBe(1);
  expect(analysis.requirements.withCitationsCount).toBe(1);

  // Assert on documents analysis
  expect(analysis.documents.byStatus).toEqual(
    expect.arrayContaining([
      { status: 'EMBEDDED', count: 2 },
      { status: 'METADATA_ONLY', count: 1 },
    ]),
  );
  expect(analysis.documents.municipalityConfidenceBuckets.high).toBe(1);
  expect(analysis.documents.municipalityConfidenceBuckets.low).toBe(1);

  // Assert on coverage analysis
  expect(analysis.coverage.documentsWithRequirements).toBe(1);
  expect(analysis.coverage.documentsWithoutRequirements).toBe(2);
  expect(analysis.coverage.municipalitiesDocumentsOnly).toContain('Göteborg');
});
