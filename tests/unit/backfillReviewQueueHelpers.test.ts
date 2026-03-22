import { describe, expect, it } from 'vitest';

import { dedupeReviewIntents, mergeReviewReasons } from '../../scripts/backfill/reviewQueueHelpers';

describe('backfill review queue helpers', () => {
  it('dedupes repeated intents for the same document, queue type and field', () => {
    const deduped = dedupeReviewIntents([
      {
        documentId: 'doc-1',
        queueType: 'DISAGREEMENT',
        fieldName: 'legalStatus',
        proposedValue: null,
        confidence: null,
        reason: 'multiple diarie numbers in same case candidate (a)',
      },
      {
        documentId: 'doc-1',
        queueType: 'DISAGREEMENT',
        fieldName: 'legalStatus',
        proposedValue: null,
        confidence: null,
        reason: 'multiple diarie numbers in same case candidate (a)',
      },
      {
        documentId: 'doc-1',
        queueType: 'DISAGREEMENT',
        fieldName: 'legalStatus',
        proposedValue: null,
        confidence: null,
        reason: 'multiple diarie numbers in same case candidate (b)',
      },
    ]);

    expect(deduped).toHaveLength(1);
    expect(deduped[0]?.reason).toBe(
      'multiple diarie numbers in same case candidate (a) | multiple diarie numbers in same case candidate (b)',
    );
  });

  it('merges review reasons without duplicating identical segments', () => {
    expect(
      mergeReviewReasons(
        'confidence 0.88 < threshold 0.9',
        'confidence 0.88 < threshold 0.9 | text regex match',
        'text regex match',
      ),
    ).toBe('confidence 0.88 < threshold 0.9 | text regex match');
  });
});
