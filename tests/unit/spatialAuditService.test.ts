import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auditSguRiskAtPoint: vi.fn(),
  queryRaw: vi.fn(),
}));

vi.mock('../../server/db/prisma', () => ({
  prisma: {
    $queryRaw: mocks.queryRaw,
  },
}));

vi.mock('../../server/services/sguRiskService', () => ({
  auditSguRiskAtPoint: mocks.auditSguRiskAtPoint,
}));

import { runSpatialAudit } from '../../server/services/spatialAuditService';

describe('spatialAuditService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auditSguRiskAtPoint.mockResolvedValue({
      summary: 'SGU: inga jordskredsrisker identifierade.',
      riskLevel: 'NONE',
      manualReviewRequired: false,
      coverageMode: 'complete',
      groundLayerScale: '1:1M',
      hits: [],
    });
  });

  it('summarises protected-area overlaps alongside SGU risk output', async () => {
    mocks.queryRaw.mockResolvedValueOnce([
      {
        nvr_id: 'nvr-1',
        name: 'Reservat A',
        protection_type: 'Naturreservat',
        decision_status: 'GALLANDE',
      },
    ]);

    const result = await runSpatialAudit(60.14, 15.2);

    expect(result).toMatchObject({
      protectedAreaAvailable: true,
      isProtected: true,
      protectedAreaHits: [
        expect.objectContaining({
          nvr_id: 'nvr-1',
          name: 'Reservat A',
        }),
      ],
      sgu: expect.objectContaining({
        summary: 'SGU: inga jordskredsrisker identifierade.',
      }),
    });
    expect(result.text).toContain('Skyddad natur: platsen overlappar 1 registrerat omrade');
    expect(result.text).toContain('SGU: inga jordskredsrisker identifierade.');
    expect(result.sources).toHaveLength(3);
  });

  it('reports clean results when no protected areas overlap the point', async () => {
    mocks.queryRaw.mockResolvedValueOnce([]);

    const result = await runSpatialAudit(60.14, 15.2);

    expect(result.protectedAreaHits).toEqual([]);
    expect(result.protectedAreaAvailable).toBe(true);
    expect(result.isProtected).toBe(false);
    expect(result.text).toContain('ingen direkt overlapptreff i lokal NVR-databas');
  });

  it('falls back to a friendly warning when the local protected-area table is unavailable', async () => {
    mocks.queryRaw.mockRejectedValueOnce(new Error('relation env.protected_area does not exist'));

    const result = await runSpatialAudit(60.14, 15.2);

    expect(result.protectedAreaAvailable).toBe(false);
    expect(result.protectedAreaWarning).toBe('Lokal tabell for skyddad natur saknas i databasen.');
    expect(result.isProtected).toBe(false);
    expect(result.text).toContain('Lokal tabell for skyddad natur saknas i databasen.');
  });
});
