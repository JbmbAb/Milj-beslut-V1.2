import { beforeEach, describe, expect, it, vi } from 'vitest';

const spatialAuditMock = vi.hoisted(() => ({ runSpatialAudit: vi.fn() }));

vi.mock('../../server/services/spatialAuditService', () => spatialAuditMock);

import { resolveMassSiteSensitivity } from '../../server/modules/c-notification-mass/massSpatialSensitivity';

function baseAudit(overrides: Record<string, unknown> = {}) {
  return {
    isProtected: false,
    protectedAreaAvailable: true,
    distanceToWaterMeters: 500,
    distanceToWaterAvailable: true,
    sgu: { riskLevel: 'LOW', flags: [] },
    insar: { warningFlags: [] },
    ...overrides,
  };
}

describe('resolveMassSiteSensitivity -- unresolved spatial data (W3c)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('W3c: an unavailable water-distance check (null, available:false) is surfaced as unresolved, never as "not near water"', async () => {
    spatialAuditMock.runSpatialAudit.mockResolvedValueOnce(
      baseAudit({ distanceToWaterMeters: null, distanceToWaterAvailable: false }),
    );

    const res = await resolveMassSiteSensitivity({ siteLat: 1, siteLng: 2 });

    expect(Array.isArray(res.spatialDataUnresolved)).toBe(true);
    expect(res.spatialDataUnresolved).toContain('distance-to-water-unavailable');
    expect(res.isSensitiveArea).toBe(true);
    expect(res.source).toBe('spatial-audit');
  });

  it('M1 -- W3c: a CHECKED site with no water within 500m (null, available:true) is genuinely clean, not unresolved', async () => {
    spatialAuditMock.runSpatialAudit.mockResolvedValueOnce(
      baseAudit({ distanceToWaterMeters: null, distanceToWaterAvailable: true }),
    );

    const res = await resolveMassSiteSensitivity({ siteLat: 1, siteLng: 2 });

    expect(res.spatialDataUnresolved).toEqual([]);
    expect(res.isSensitiveArea).toBe(false);
  });

  it('M2 -- W3c: SGU manualReviewRequired without sgu:unavailable (sample coverage / landslide hit) is a normal state, not unresolved', async () => {
    spatialAuditMock.runSpatialAudit.mockResolvedValueOnce(
      baseAudit({ sgu: { riskLevel: 'LOW', manualReviewRequired: true, flags: ['sgu:sample-coverage'] } }),
    );

    const res = await resolveMassSiteSensitivity({ siteLat: 1, siteLng: 2 });

    expect(res.spatialDataUnresolved).toEqual([]);
    expect(res.isSensitiveArea).toBe(false);
  });

  it('M2 -- W3c: the real SGU/InSAR failure signals (flags/warningFlags) are surfaced as unresolved, not folded into a clean low-risk result', async () => {
    spatialAuditMock.runSpatialAudit.mockResolvedValueOnce(
      baseAudit({
        sgu: { riskLevel: 'LOW', flags: ['sgu:unavailable'] },
        insar: { warningFlags: ['insar:unavailable'] },
      }),
    );

    const res = await resolveMassSiteSensitivity({ siteLat: 1, siteLng: 2 });

    expect(res.spatialDataUnresolved).toContain('sgu-unavailable');
    expect(res.spatialDataUnresolved).toContain('insar-unavailable');
    expect(res.isSensitiveArea).toBe(true);
  });

  it('S5 -- W3c: an unavailable protected-area check is surfaced as unresolved, never as "not protected"', async () => {
    spatialAuditMock.runSpatialAudit.mockResolvedValueOnce(
      baseAudit({ isProtected: false, protectedAreaAvailable: false }),
    );

    const res = await resolveMassSiteSensitivity({ siteLat: 1, siteLng: 2 });

    expect(res.spatialDataUnresolved).toContain('protected-area-unavailable');
    expect(res.isSensitiveArea).toBe(true);
  });

  it('S4 -- W3c: the pre-existing positive criteria still work after the unresolved-tracking refactor', async () => {
    spatialAuditMock.runSpatialAudit.mockResolvedValueOnce(baseAudit({ isProtected: true }));
    const protectedRes = await resolveMassSiteSensitivity({ siteLat: 1, siteLng: 2 });
    expect(protectedRes.isSensitiveArea).toBe(true);
    expect(protectedRes.spatialDataUnresolved).toEqual([]);

    spatialAuditMock.runSpatialAudit.mockResolvedValueOnce(
      baseAudit({ distanceToWaterMeters: 50, distanceToWaterAvailable: true }),
    );
    const nearWaterRes = await resolveMassSiteSensitivity({ siteLat: 1, siteLng: 2 });
    expect(nearWaterRes.isSensitiveArea).toBe(true);
    expect(nearWaterRes.spatialDataUnresolved).toEqual([]);

    spatialAuditMock.runSpatialAudit.mockResolvedValueOnce(baseAudit({ sgu: { riskLevel: 'HIGH', flags: [] } }));
    const highSoilRes = await resolveMassSiteSensitivity({ siteLat: 1, siteLng: 2 });
    expect(highSoilRes.isSensitiveArea).toBe(true);
    expect(highSoilRes.spatialDataUnresolved).toEqual([]);
  });

  it('W3c: fully resolved, genuinely clean data is not sensitive and has no unresolved items', async () => {
    spatialAuditMock.runSpatialAudit.mockResolvedValueOnce(baseAudit());

    const res = await resolveMassSiteSensitivity({ siteLat: 1, siteLng: 2 });

    expect(res.spatialDataUnresolved).toEqual([]);
    expect(res.isSensitiveArea).toBe(false);
  });
});
