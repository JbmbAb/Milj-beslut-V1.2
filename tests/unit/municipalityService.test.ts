import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  queryRaw: vi.fn(),
}));

vi.mock('../../server/db/prisma', () => ({
  prisma: {
    $queryRaw: mocks.queryRaw,
  },
}));

import { getMunicipalityInsight } from '../../server/services/municipalityService';

describe('municipalityService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('builds municipality insights from requirement and category distributions', async () => {
    mocks.queryRaw
      .mockResolvedValueOnce([
        {
          req_count: 50,
          case_count: 4,
          avg_reqs: 12.5,
        },
      ])
      .mockResolvedValueOnce([
        { category: 'DagvattenLakvatten', count: 12 },
        { category: 'KontrollProvtagning', count: 9 },
        { category: 'Ytkonstruktion', count: 7 },
        { category: 'Storningsskydd', count: 6 },
      ]);

    const result = await getMunicipalityInsight(' Stockholm ');

    expect(result).toEqual({
      name: 'Stockholm',
      index: 0.52,
      ranking: 143,
      commonRisks: ['Vattenförorening', 'KontrollProvtagning', 'Markförorening'],
      commonRequirements: ['Oljeavskiljare', 'Provtagningsplan', 'Tät platta / Invallning'],
      stats: {
        avgRequirements: 12.5,
        riskCoveragePct: 67,
        documentationLevel: 'Hög',
      },
      patterns: ['Dokumentationsbaserad tillsyn', 'Hydrologiskt fokus', 'Bred riskprofil'],
    });
  });

  it('falls back to neutral municipality defaults when no data exists', async () => {
    mocks.queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    const result = await getMunicipalityInsight('Orsa');

    expect(result).toEqual({
      name: 'Orsa',
      index: 0,
      ranking: 290,
      commonRisks: [],
      commonRequirements: [],
      stats: {
        avgRequirements: 0,
        riskCoveragePct: 0,
        documentationLevel: 'Låg',
      },
      patterns: [],
    });
  });

  it('adds Omfattande kravbild pattern when avgReqs exceeds 30', async () => {
    mocks.queryRaw
      .mockResolvedValueOnce([{ req_count: 200, case_count: 4, avg_reqs: 40 }])
      .mockResolvedValueOnce([
        { category: 'KontrollProvtagning', count: 60 },
        { category: 'DagvattenLakvatten', count: 40 },
        { category: 'Ytkonstruktion', count: 30 },
        { category: 'Storningsskydd', count: 20 },
      ]);

    const result = await getMunicipalityInsight('Göteborg');

    expect(result.patterns).toContain('Omfattande kravbild');
  });

  it('maps Storningsskydd to Buller & Damm and LagringVolymTid to Brand & Spill', async () => {
    mocks.queryRaw
      .mockResolvedValueOnce([{ req_count: 12, case_count: 3, avg_reqs: 4 }])
      .mockResolvedValueOnce([
        { category: 'Storningsskydd', count: 5 },
        { category: 'LagringVolymTid', count: 4 },
        { category: 'Ytkonstruktion', count: 3 },
      ]);

    const result = await getMunicipalityInsight('Malmö');

    expect(result.commonRisks).toContain('Buller & Damm');
    expect(result.commonRisks).toContain('Brand & Spill');
    expect(result.commonRequirements).toContain('Journalföring av mängder');
  });

  it('returns Medel documentationLevel when docRatio is between 0.05 and 0.15', async () => {
    // docRatio = KontrollProvtagning_count / total_reqs; aim for ~0.08 (between 0.05 and 0.15)
    mocks.queryRaw
      .mockResolvedValueOnce([{ req_count: 50, case_count: 5, avg_reqs: 10 }])
      .mockResolvedValueOnce([
        { category: 'KontrollProvtagning', count: 4 }, // 4/50 = 0.08 → Medel
        { category: 'DagvattenLakvatten', count: 3 },
        { category: 'Ytkonstruktion', count: 2 },
      ]);

    const result = await getMunicipalityInsight('Linköping');

    expect(result.stats.documentationLevel).toBe('Medel');
  });

  it('does not include Hydrologiskt fokus when DagvattenLakvatten ratio is too low', async () => {
    mocks.queryRaw
      .mockResolvedValueOnce([{ req_count: 100, case_count: 5, avg_reqs: 20 }])
      .mockResolvedValueOnce([
        { category: 'Storningsskydd', count: 2 },
        { category: 'DagvattenLakvatten', count: 1 }, // 1/100 = 0.01 < 0.05
        { category: 'KontrollProvtagning', count: 1 },
      ]);

    const result = await getMunicipalityInsight('Västerås');

    expect(result.patterns).not.toContain('Hydrologiskt fokus');
  });

  it('produces a generic category fallback label for unknown category names', async () => {
    mocks.queryRaw
      .mockResolvedValueOnce([{ req_count: 6, case_count: 3, avg_reqs: 2 }])
      .mockResolvedValueOnce([{ category: 'OkändKategori', count: 6 }]);

    const result = await getMunicipalityInsight('Kiruna');

    expect(result.commonRequirements[0]).toBe('Krav inom OkändKategori');
  });
});
