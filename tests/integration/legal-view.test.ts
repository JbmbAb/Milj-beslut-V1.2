import { describe, it, expect, beforeAll } from 'vitest';
import supertest from 'supertest';
import { createApp } from '../../server/createApp';
import { prisma } from '../../server/db/prisma';

describe('Legal View API Verification', () => {
  let app: any;
  let request: any;

  beforeAll(async () => {
    app = createApp();
    request = supertest(app);
  });

  it('should return 404 for non-existent document', async () => {
    const res = await request.get('/api/legal/view/non-existent-id');
    expect(res.status).toBe(404);
  });

  it('should redirect to sourceUrl if local file is missing but URL exists', async () => {
    // Skapa en test-post i databasen
    const testRecord = await prisma.legalCorpusRecord.upsert({
      where: { id: 'test-external-link' },
      update: {},
      create: {
        id: 'test-external-link',
        title: 'Test Extern Dom',
        sourceUrl: 'https://example.com/ruling.pdf',
        searchText: 'test text',
        metadata: {},
        recordKey: 'test-key',
        canonicalKey: 'test-canonical',
        sourceFamily: 'TEST_FAMILY',
        sourceType: 'TEST_TYPE',
        sourceSystem: 'TEST_SYSTEM',
        sourcePath: '/test/path.pdf',
        language: 'sv',
      },
    });

    const res = await request.get(`/api/legal/view/${testRecord.id}`);
    expect(res.status).toBe(302);
    expect(res.header.location).toBe('https://example.com/ruling.pdf');

    // Städa upp
    await prisma.legalCorpusRecord.delete({ where: { id: testRecord.id } });
  });
});
