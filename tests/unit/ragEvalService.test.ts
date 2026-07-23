import { describe, expect, it } from 'vitest';
import { evaluateRagRuns, faithfulnessScore } from '../../server/services/ragEvalService';

describe('ragEvalService', () => {
  it('computes precision, recall, faithfulness, citation accuracy and cache hit rate', () => {
    const metrics = evaluateRagRuns(
      [
        {
          query: 'Avstånd till vatten?',
          relevantIds: ['doc-1', 'chunk-a'],
          goldKeywords: ['vatten', 'meter'],
        },
        {
          query: 'Skyddad natur?',
          relevantIds: ['doc-2'],
          goldKeywords: ['natura'],
        },
      ],
      [
        {
          answer: 'Avstånd till vatten är 120 meter.',
          sources: [{ documentId: 'doc-1', chunkId: 'chunk-a' }, { documentId: 'noise' }],
          cacheHit: true,
        },
        {
          answer: 'Ingen natura 2000 träff.',
          sources: [{ documentId: 'doc-2' }],
          cacheHit: false,
        },
      ],
    );

    expect(metrics.caseCount).toBe(2);
    expect(metrics.precision).toBeGreaterThan(0.5);
    expect(metrics.recall).toBeGreaterThan(0.5);
    expect(metrics.faithfulness).toBeGreaterThan(0.5);
    expect(metrics.citationAccuracy).toBeGreaterThan(0.5);
    expect(metrics.embeddingCacheHitRate).toBe(0.5);
  });

  it('faithfulnessScore handles empty keywords', () => {
    expect(faithfulnessScore('svar')).toBe(0.5);
    expect(faithfulnessScore('')).toBe(0);
  });
});
