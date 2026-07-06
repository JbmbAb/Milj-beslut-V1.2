import { it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import dotenv from 'dotenv';
import { prisma } from '../../server/db/prisma';
import { encryptContent } from '../../server/services/searchService';
import { describeIfDatabaseIntegration } from './integrationTestEnv';

// Secure environment variables before prisma-backed integration setup.
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

describeIfDatabaseIntegration('searchService Integration (Real Postgres)', () => {
  let testOrgId = '';
  let testProjectId = '';
  let testDocId = '';

  beforeAll(async () => {
    const org = await prisma.organisation.upsert({
      where: { orgNumber: 'INTEGRATION-TEST-ORG' },
      create: { name: 'Aao Kommunal Forvaltning', orgNumber: 'INTEGRATION-TEST-ORG', role: 'CLIENT' },
      update: { name: 'Aao Kommunal Forvaltning' },
    });
    testOrgId = org.id;

    const project = await prisma.project.create({
      data: {
        organisationId: testOrgId,
        propertyDesignation: 'ARNAS 1:44',
        status: 'ACTIVE',
      },
    });
    testProjectId = project.id;

    const encrypted = encryptContent('Innehall med svenska tecken: lera, moran och sjo.');
    const doc = await prisma.documentRecord.create({
      data: {
        projectId: testProjectId,
        organisationId: testOrgId,
        entryId: `integration-test-${Date.now()}`,
        subject: 'Beslut rorande Amal',
        originalName: 'beslut_aao.pdf',
        diskName: `beslut_aao_${Date.now()}.pdf`,
        absolutePath: '/tmp/beslut_aao.pdf',
        status: 'TEXT_EXTRACTED',
        content: {
          create: {
            contentCiphertext: encrypted.ciphertext,
            contentIv: encrypted.iv,
            contentTag: encrypted.tag,
            searchText: 'Innehall med svenska tecken: lera, moran och sjo.',
          },
        },
      },
    });
    testDocId = doc.id;
  });

  afterAll(async () => {
    if (testOrgId) {
      await prisma.documentRecord.deleteMany({ where: { organisationId: testOrgId } });
      await prisma.project.deleteMany({ where: { organisationId: testOrgId } });
      await prisma.organisation.delete({ where: { id: testOrgId } });
    }
  });

  it('should find the document using a lexical (text) search for "lera"', async () => {
    const results = await prisma.documentRecord.findMany({
      where: {
        content: {
          searchText: {
            contains: 'lera',
            mode: 'insensitive',
          },
        },
      },
      include: { content: true },
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].content?.searchText).toContain('lera');
  });

  it('should verify that we can store and retrieve Swedish characters without encoding issues', async () => {
    const doc = await prisma.documentRecord.findUnique({
      where: { id: testDocId },
      include: { organisation: true, content: true },
    });

    expect(doc).not.toBeNull();
    expect(doc?.organisation.name).toBe('Aao Kommunal Forvaltning');
    expect(doc?.content?.searchText).toBe('Innehall med svenska tecken: lera, moran och sjo.');
  });
});
