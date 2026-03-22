import { describe, expect, it, vi } from 'vitest';

import { buildCoverageReport } from '../../scripts/backfill/coverageHelpers';

describe('backfill coverage helpers', () => {
  it('excludes failed documents from the fail-gate precision basis', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-19T10:00:00.000Z'));

    const report = buildCoverageReport({
      totalDocuments: 1884,
      failedDocuments: 543,
      municipalityCount: 1337,
      diarieCount: 573,
      decisionTypeCount: 573,
      activityCodeCount: 100,
      wasteTypeCount: 200,
      caseCandidates: 916,
      materializedCases: 6,
      requirementRecords: 0,
      requirementCitations: 0,
      evidenceRows: 21107,
      openReviewItems: 100,
      openDisagreements: 20,
    });

    expect(report.documents.eligible).toBe(1341);
    expect(report.failGate.municipalityPrecision).toBe('0.997');
    expect(report.failGate.diariePrecision).toBe('0.427');
    expect(report.failGate.precisionBasis.excludesFailedDocuments).toBe(true);

    vi.useRealTimers();
  });
});
