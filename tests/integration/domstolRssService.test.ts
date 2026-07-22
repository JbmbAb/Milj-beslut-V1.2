import { prisma } from '../../server/db/prisma';
import { it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

import { ingestDomstolRssFeed } from '../../server/services/domstolRssService';
import { getJudgmentByGuid } from '../../server/repositories/judgmentRepository';
import fs from 'node:fs/promises';
import path from 'node:path';
import { describeIfDatabaseIntegration } from './integrationTestEnv';



describeIfDatabaseIntegration('domstolRssService Integration', () => {
  const mockRssFeedPath = path.join(__dirname, '../fixtures/domstol-rss-miljo-feed-sample.xml');
  let originalFetch: typeof globalThis.fetch;
  let mockRssContent: string;

  beforeAll(async () => {
    await prisma.$connect();
    mockRssContent = await fs.readFile(mockRssFeedPath, 'utf8');
    originalFetch = globalThis.fetch; // Store original fetch
  });

  afterAll(async () => {
    globalThis.fetch = originalFetch; // Restore original fetch
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    // Clear the JudgmentRecord table before each test
    await prisma.judgmentRecord.deleteMany({});

    // Mock fetch to return our local RSS feed content
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('domstol.se/feed')) {
        return new Response(mockRssContent, {
          status: 200,
          headers: { 'Content-Type': 'application/xml' },
        });
      }
      return originalFetch(input); // Fallback for other requests
    }) as typeof globalThis.fetch;
  });

  it('should ingest judgments from the RSS feed into the database', async () => {
    const { newJudgments, updatedJudgments } = await ingestDomstolRssFeed();

    expect(newJudgments).toBeGreaterThan(0);
    expect(updatedJudgments).toBe(0); // First run, all should be new

    const totalJudgmentsInDb = await prisma.judgmentRecord.count();
    expect(totalJudgmentsInDb).toBe(newJudgments);

    const sampleGuid = '160013'; // From the mock RSS feed
    const judgment = await getJudgmentByGuid(sampleGuid);
    expect(judgment).toBeDefined();
    expect(judgment?.title).toBe('Mål: F 11878-24');
    expect(judgment?.description).toContain('MÖD har undanröjt LM:s beslut');
    expect(judgment?.pubDate.getFullYear()).toBe(2025);
  });

  it('should update existing judgments on subsequent ingestion', async () => {
    // First ingestion
    await ingestDomstolRssFeed();

    // Modify the mock RSS content to simulate an update
    const updatedRssContent = mockRssContent.replace('Mål: F 11878-24', 'Mål: F 11878-24 (UPPDATERAD)');
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('domstol.se/feed')) {
        return new Response(updatedRssContent, {
          status: 200,
          headers: { 'Content-Type': 'application/xml' },
        });
      }
      return originalFetch(input);
    }) as typeof globalThis.fetch;

    // Second ingestion
    const { newJudgments, updatedJudgments } = await ingestDomstolRssFeed();

    expect(newJudgments).toBe(0);
    expect(updatedJudgments).toBeGreaterThan(0); // At least one judgment should be updated

    const sampleGuid = '160013';
    const judgment = await getJudgmentByGuid(sampleGuid);
    expect(judgment?.title).toBe('Mål: F 11878-24 (UPPDATERAD)');
  });

  it('should handle an empty RSS feed gracefully', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('domstol.se/feed')) {
        return new Response('<rss><channel></channel></rss>', {
          status: 200,
          headers: { 'Content-Type': 'application/xml' },
        });
      }
      return originalFetch(input);
    }) as typeof globalThis.fetch;

    const { newJudgments, updatedJudgments } = await ingestDomstolRssFeed();
    expect(newJudgments).toBe(0);
    expect(updatedJudgments).toBe(0);
    expect(await prisma.judgmentRecord.count()).toBe(0);
  });

  it('should handle network errors during fetch', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('domstol.se/feed')) {
        return new Response('Network error', { status: 500 });
      }
      return originalFetch(input);
    }) as typeof globalThis.fetch;

    await expect(ingestDomstolRssFeed()).rejects.toThrow('Failed to fetch RSS feed');
  });
});
