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
      index: 0.45,
      ranking: 290,
      commonRisks: ['Allmänna miljörisker'],
      commonRequirements: ['Egenkontroll'],
      stats: {
        avgRequirements: 0,
        riskCoveragePct: 0,
        documentationLevel: 'Låg',
      },
      patterns: ['Standardiserad tillsyn'],
    });
  });
});
