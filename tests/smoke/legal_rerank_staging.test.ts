/**
 * Staging smoke — legal rerank (vecka 3).
 * Körs manuellt eller i CI när STAGING_BASE_URL och LEGAL_RERANKER=on i staging.
 *
 * Skippar om STAGING_BASE_URL saknas.
 */
import { describe, expect, it } from 'vitest';

const stagingBase = (process.env.STAGING_BASE_URL || '').replace(/\/$/, '');
const describeStaging = stagingBase ? describe : describe.skip;

describeStaging('legal rerank staging smoke', () => {
  it('searchLegalCorpus svarar med reranker-metadata', async () => {
    const res = await fetch(`${stagingBase}/api/health`, { method: 'GET' });
    expect(res.ok).toBe(true);

    const loginRes = await fetch(`${stagingBase}/api/admin/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: process.env.ADMIN_CONSOLE_USERNAME || 'admin',
        password: process.env.ADMIN_CONSOLE_PASSWORD || 'admin',
      }),
    });
    
    expect(loginRes.ok, `Login to staging failed: ${loginRes.status}`).toBe(true);
    const loginBody = await loginRes.json() as { accessToken: string };
    const token = loginBody.accessToken;

    const searchRes = await fetch(`${stagingBase}/api/legal/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        query: 'strandskydd dispens enskilt avlopp',
      }),
    });

    expect(searchRes.ok, `Search on staging failed: ${searchRes.status}`).toBe(true);
    const body = await searchRes.json() as {
      results: Array<unknown>;
      meta: {
        rerankerEngine: string;
        promptVersion: string;
        rerankerStatus: string;
      };
    };

    expect(body.results, 'Expected results list from search').toBeDefined();
    expect(body.meta, 'Expected meta block from search').toBeDefined();
    expect(body.meta.rerankerEngine, 'Expected rerankerEngine in meta').toBeDefined();
    expect(body.meta.promptVersion, 'Expected promptVersion in meta').toBeDefined();
    expect(body.meta.rerankerStatus, 'Expected rerankerStatus in meta').toBeDefined();
  }, 30_000);
});

describe('legal rerank staging smoke (local placeholder)', () => {
  it('STAGING_BASE_URL dokumenterad för manuell körning', () => {
    if (!stagingBase) {
      expect(process.env.STAGING_BASE_URL).toBeUndefined();
    }
  });
});
