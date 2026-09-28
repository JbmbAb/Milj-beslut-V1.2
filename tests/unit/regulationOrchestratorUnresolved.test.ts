import { beforeEach, describe, expect, it, vi } from 'vitest';

const spatialAuditMock = vi.hoisted(() => ({ runSpatialAudit: vi.fn() }));
const mpfMock = vi.hoisted(() => ({ evaluateMpfOperation: vi.fn() }));

vi.mock('../../server/services/spatialAuditService', () => spatialAuditMock);
vi.mock('../../services/mpfEngine', () => mpfMock);

import { classifyProjectRegulatoryTrack } from '../../server/services/regulationOrchestrator';

describe('classifyProjectRegulatoryTrack -- unresolved spatial data (W3c)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mpfMock.evaluateMpfOperation.mockReturnValue({ permitClass: 'C', notes: 'notes' });
  });

  it('W3c: an unavailable water-distance check is never reported as "not near water" -- it is surfaced as unresolved', async () => {
    spatialAuditMock.runSpatialAudit.mockResolvedValueOnce({
      isProtected: false,
      distanceToWaterMeters: null,
      distanceToWaterAvailable: false,
      sgu: { riskLevel: 'LOW', groundLayer: { hit: null } },
      insar: { warningFlags: [] },
    });

    const res = await classifyProjectRegulatoryTrack({
      lat: 1,
      lng: 2,
      ewcCode: '17 05 04',
      annualVolume: 10,
    });

    expect(res.spatialDataUnresolved).toContain('distance-to-water-unavailable');
    expect(res.isSensitiveArea).toBe(true);
  });

  it('W3c: a failed SGU check (manualReviewRequired) is never treated as low soil vulnerability', async () => {
    spatialAuditMock.runSpatialAudit.mockResolvedValueOnce({
      isProtected: false,
      distanceToWaterMeters: 500,
      distanceToWaterAvailable: true,
      sgu: { riskLevel: 'LOW', manualReviewRequired: true, groundLayer: { hit: null } },
      insar: { warningFlags: [] },
    });

    const res = await classifyProjectRegulatoryTrack({
      lat: 1,
      lng: 2,
      ewcCode: '17 05 04',
      annualVolume: 10,
    });

    expect(res.spatialDataUnresolved).toContain('sgu-manual-review-required');
    expect(res.isSensitiveArea).toBe(true);
  });

  it('W3c: a failed InSAR check surfaces insar-unavailable and does not silently pass as clean', async () => {
    spatialAuditMock.runSpatialAudit.mockResolvedValueOnce({
      isProtected: false,
      distanceToWaterMeters: 500,
      distanceToWaterAvailable: true,
      sgu: { riskLevel: 'LOW', groundLayer: { hit: null } },
      insar: { warningFlags: ['insar:unavailable'] },
    });

    const res = await classifyProjectRegulatoryTrack({
      lat: 1,
      lng: 2,
      ewcCode: '17 05 04',
      annualVolume: 10,
    });

    expect(res.spatialDataUnresolved).toContain('insar-unavailable');
    expect(res.isSensitiveArea).toBe(true);
  });

  it('W3c: fully resolved, genuinely clean data reports no unresolved items and is not sensitive', async () => {
    spatialAuditMock.runSpatialAudit.mockResolvedValueOnce({
      isProtected: false,
      distanceToWaterMeters: 500,
      distanceToWaterAvailable: true,
      sgu: { riskLevel: 'LOW', manualReviewRequired: false, groundLayer: { hit: null } },
      insar: { warningFlags: [] },
    });

    const res = await classifyProjectRegulatoryTrack({
      lat: 1,
      lng: 2,
      ewcCode: '17 05 04',
      annualVolume: 10,
    });

    expect(res.spatialDataUnresolved).toEqual([]);
    expect(res.isSensitiveArea).toBe(false);
  });
});
