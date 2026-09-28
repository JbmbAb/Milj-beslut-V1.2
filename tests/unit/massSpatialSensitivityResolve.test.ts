import { beforeEach, describe, expect, it, vi } from 'vitest';

const spatialAuditMock = vi.hoisted(() => ({ runSpatialAudit: vi.fn() }));

vi.mock('../../server/services/spatialAuditService', () => spatialAuditMock);

import { resolveMassSiteSensitivity } from '../../server/modules/c-notification-mass/massSpatialSensitivity';

describe('resolveMassSiteSensitivity -- unresolved spatial data (W3c)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('W3c: an unavailable water-distance check is surfaced as unresolved, not "not near water"', async () => {
    spatialAuditMock.runSpatialAudit.mockResolvedValueOnce({
      isProtected: false,
      distanceToWaterMeters: null,
      distanceToWaterAvailable: false,
      sgu: { riskLevel: 'LOW' },
      insar: { warningFlags: [] },
    });

    const res = await resolveMassSiteSensitivity({ siteLat: 1, siteLng: 2 });

    expect(res.spatialDataUnresolved).toContain('distance-to-water-unavailable');
    expect(res.isSensitiveArea).toBe(true);
    expect(res.source).toBe('spatial-audit');
  });

  it('W3c: a failed SGU/InSAR check is surfaced as unresolved, not folded into a clean low-risk result', async () => {
    spatialAuditMock.runSpatialAudit.mockResolvedValueOnce({
      isProtected: false,
      distanceToWaterMeters: 500,
      distanceToWaterAvailable: true,
      sgu: { riskLevel: 'LOW', manualReviewRequired: true },
      insar: { warningFlags: ['insar:unavailable'] },
    });

    const res = await resolveMassSiteSensitivity({ siteLat: 1, siteLng: 2 });

    expect(res.spatialDataUnresolved).toContain('sgu-manual-review-required');
    expect(res.spatialDataUnresolved).toContain('insar-unavailable');
    expect(res.isSensitiveArea).toBe(true);
  });

  it('W3c: fully resolved, genuinely clean data is not sensitive and has no unresolved items', async () => {
    spatialAuditMock.runSpatialAudit.mockResolvedValueOnce({
      isProtected: false,
      distanceToWaterMeters: 500,
      distanceToWaterAvailable: true,
      sgu: { riskLevel: 'LOW', manualReviewRequired: false },
      insar: { warningFlags: [] },
    });

    const res = await resolveMassSiteSensitivity({ siteLat: 1, siteLng: 2 });

    expect(res.spatialDataUnresolved).toEqual([]);
    expect(res.isSensitiveArea).toBe(false);
  });
});
