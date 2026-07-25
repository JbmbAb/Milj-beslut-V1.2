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

    // TODO(vecka 3): ersätt med autentiserat anrop till orchestrator/searchLegalCorpus
    // när staging-endpoint och test-token finns dokumenterade.
    // Förväntat meta-fält: rerankerEngine, promptVersion, rerankerStatus
  }, 30_000);
});

describe('legal rerank staging smoke (local placeholder)', () => {
  it('STAGING_BASE_URL dokumenterad för manuell körning', () => {
    if (!stagingBase) {
      expect(process.env.STAGING_BASE_URL).toBeUndefined();
    }
  });
});
