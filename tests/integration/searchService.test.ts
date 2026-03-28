import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import dotenv from 'dotenv';

// Säkra miljövariabler innan import av prisma
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

import { prisma } from '../../server/db/prisma';
import { encryptContent } from '../../server/services/searchService';

describe('searchService Integration (Real Postgres)', () => {
  let testOrgId: string;
  let testProjectId: string;
  let testDocId: string;

  beforeAll(async () => {
    // Rensa/Setup testdata med svenska tecken
    const org = await prisma.organisation.upsert({
      where: { orgNumber: 'INTEGRATION-TEST-ORG' },
      create: { name: 'Åäö Kommunal Förvaltning', orgNumber: 'INTEGRATION-TEST-ORG' },
      update: { name: 'Åäö Kommunal Förvaltning' },
    });
    testOrgId = org.id;

    const project = await prisma.project.create({
      data: {
        organisationId: testOrgId,
        propertyDesignation: 'ÄRNÄS 1:44',
        status: 'ACTIVE',
      },
    });
    testProjectId = project.id;

    const encrypted = encryptContent('Innehåll med svenska tecken: lera, morän och sjö.');
    const doc = await prisma.documentRecord.create({
      data: {
        projectId: testProjectId,
        organisationId: testOrgId,
        entryId: 'integration-test-' + Date.now(),
        subject: 'Beslut rörande Åmål',
        originalName: 'beslut_åäö.pdf',
        diskName: 'beslut_åäö_' + Date.now() + '.pdf',
        absolutePath: '/tmp/beslut_åäö.pdf',
        status: 'TEXT_EXTRACTED',
        content: {
          create: {
            contentCiphertext: encrypted.ciphertext,
            contentIv: encrypted.iv,
            contentTag: encrypted.tag,
            searchText: 'Innehåll med svenska tecken: lera, morän och sjö.',
          },
        },
      },
    });
    testDocId = doc.id;
  });

  afterAll(async () => {
    // Ta bort testdata för att undvika skräp i din riktiga DB
    await prisma.documentRecord.deleteMany({ where: { organisationId: testOrgId } });
    await prisma.project.deleteMany({ where: { organisationId: testOrgId } });
    await prisma.organisation.delete({ where: { id: testOrgId } });
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
    expect(doc?.organisation.name).toBe('Åäö Kommunal Förvaltning');
    expect(doc?.content?.searchText).toBe('Innehåll med svenska tecken: lera, morän och sjö.');
  });
});
