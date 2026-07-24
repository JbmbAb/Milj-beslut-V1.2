import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../server/db/prisma', () => ({
  prisma: {
    $queryRaw: vi.fn(),
    documentRecord: {
      count: vi.fn(),
    },
  },
}));

vi.mock('../../server/security/env', () => ({
  hasLantmaterietAuth: vi.fn(() => false),
}));

vi.mock('../../server/services/publicUiService', () => ({
  getPublicDatasourceSummary: vi.fn(),
}));

vi.mock('../../server/services/vertexAiService', () => ({
  vertexConfigStatus: vi.fn(() => ({ configured: true, projectId: 'p', location: 'europe', missing: [] })),
}));

import { prisma } from '../../server/db/prisma';
import { getPublicDatasourceSummary } from '../../server/services/publicUiService';
import { getOperationalCoverage } from '../../server/services/operationalCoverageService';

describe('operationalCoverageService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{ count: 12 }]);
    vi.mocked(prisma.documentRecord.count).mockResolvedValueOnce(25).mockResolvedValueOnce(100);
    vi.mocked(getPublicDatasourceSummary).mockResolvedValue({
      cards: [
        { name: 'NVR', status: 'CONNECTED', activation: 'AUTO' },
        { name: 'SGU', status: 'DISCONNECTED', activation: 'MANUAL' },
      ],
    } as never);
  });

  it('returns composite percent and breakdown', async () => {
    const snapshot = await getOperationalCoverage();

    expect(snapshot.percent).toBeGreaterThanOrEqual(0);
    expect(snapshot.percent).toBeLessThanOrEqual(100);
    expect(snapshot.integrations.total).toBeGreaterThan(0);
    expect(snapshot.datasources.total).toBe(2);
    expect(snapshot.datasources.connected).toBe(1);
    expect(snapshot.municipalities.covered).toBe(12);
    expect(snapshot.documentRequirementCoveragePct).toBe(25);
  });
});
