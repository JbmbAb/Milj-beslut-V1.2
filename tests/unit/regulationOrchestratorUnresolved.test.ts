import { beforeEach, describe, expect, it, vi } from 'vitest';

const spatialAuditMock = vi.hoisted(() => ({ runSpatialAudit: vi.fn() }));
const mpfMock = vi.hoisted(() => ({ evaluateMpfOperation: vi.fn() }));

vi.mock('../../server/services/spatialAuditService', () => spatialAuditMock);
vi.mock('../../services/mpfEngine', () => mpfMock);

import { classifyProjectRegulatoryTrack } from '../../server/services/regulationOrchestrator';

function baseAudit(overrides: Record<string, unknown> = {}) {
  const { sgu: sguOverride, ...rest } = overrides as { sgu?: Record<string, unknown> };
  return {
    isProtected: false,
    protectedAreaAvailable: true,
    distanceToWaterMeters: 500,
    distanceToWaterAvailable: true,
    // groundLayer is unrelated to this unit's fix but is read unconditionally by the production
    // code's own spatialFindings.soilType projection -- always present so overriding `sgu` for a
    // test doesn't crash on an unrelated field this test isn't about.
    sgu: { riskLevel: 'LOW', flags: [], groundLayer: { hit: null }, ...sguOverride },
    insar: { warningFlags: [] },
    ...rest,
  };
}

describe('classifyProjectRegulatoryTrack -- unresolved spatial data (W3c)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mpfMock.evaluateMpfOperation.mockReturnValue({ permitClass: 'C', notes: 'notes' });
  });

  it('W3c: an unavailable water-distance check (null, available:false) is surfaced as unresolved, never as "not near water"', async () => {
    spatialAuditMock.runSpatialAudit.mockResolvedValueOnce(
      baseAudit({ distanceToWaterMeters: null, distanceToWaterAvailable: false }),
    );

    const res = await classifyProjectRegulatoryTrack({ lat: 1, lng: 2, ewcCode: '17 05 04', annualVolume: 10 });

    expect(Array.isArray(res.spatialDataUnresolved)).toBe(true);
    expect(res.spatialDataUnresolved).toContain('distance-to-water-unavailable');
    expect(res.isSensitiveArea).toBe(true);
  });

  it('M1 -- W3c: a CHECKED site with no water within 500m (null, available:true) is genuinely clean, not unresolved -- this is OD-03\'s own distinction, not the unknown case', async () => {
    spatialAuditMock.runSpatialAudit.mockResolvedValueOnce(
      baseAudit({ distanceToWaterMeters: null, distanceToWaterAvailable: true }),
    );

    const res = await classifyProjectRegulatoryTrack({ lat: 1, lng: 2, ewcCode: '17 05 04', annualVolume: 10 });

    expect(res.spatialDataUnresolved).not.toContain('distance-to-water-unavailable');
    expect(res.spatialDataUnresolved).toEqual([]);
    expect(res.isSensitiveArea).toBe(false);
  });

  it('M2 -- W3c: an SGU coverage/landslide flag (manualReviewRequired, no sgu:unavailable) is NOT the unresolved signal -- it is a normal, non-error operating state', async () => {
    spatialAuditMock.runSpatialAudit.mockResolvedValueOnce(
      baseAudit({ sgu: { riskLevel: 'LOW', manualReviewRequired: true, flags: ['sgu:sample-coverage'] } }),
    );

    const res = await classifyProjectRegulatoryTrack({ lat: 1, lng: 2, ewcCode: '17 05 04', annualVolume: 10 });

    expect(res.spatialDataUnresolved).not.toContain('sgu-unavailable');
    expect(res.spatialDataUnresolved).toEqual([]);
    expect(res.isSensitiveArea).toBe(false);
  });

  it('M2 -- W3c: the real SGU failure signal is sgu.flags containing "sgu:unavailable"', async () => {
    spatialAuditMock.runSpatialAudit.mockResolvedValueOnce(
      baseAudit({ sgu: { riskLevel: 'LOW', flags: ['sgu:unavailable'] } }),
    );

    const res = await classifyProjectRegulatoryTrack({ lat: 1, lng: 2, ewcCode: '17 05 04', annualVolume: 10 });

    expect(res.spatialDataUnresolved).toContain('sgu-unavailable');
    expect(res.isSensitiveArea).toBe(true);
  });

  it('W3c: a failed InSAR check (warningFlags: ["insar:unavailable"]) surfaces insar-unavailable, never a silent clean pass', async () => {
    spatialAuditMock.runSpatialAudit.mockResolvedValueOnce(
      baseAudit({ insar: { warningFlags: ['insar:unavailable'] } }),
    );

    const res = await classifyProjectRegulatoryTrack({ lat: 1, lng: 2, ewcCode: '17 05 04', annualVolume: 10 });

    expect(res.spatialDataUnresolved).toContain('insar-unavailable');
    expect(res.isSensitiveArea).toBe(true);
  });

  it('S5 -- W3c: an unavailable protected-area check (protectedAreaAvailable:false) is surfaced as unresolved, never as "not protected"', async () => {
    spatialAuditMock.runSpatialAudit.mockResolvedValueOnce(
      baseAudit({ isProtected: false, protectedAreaAvailable: false }),
    );

    const res = await classifyProjectRegulatoryTrack({ lat: 1, lng: 2, ewcCode: '17 05 04', annualVolume: 10 });

    expect(res.spatialDataUnresolved).toContain('protected-area-unavailable');
    expect(res.isSensitiveArea).toBe(true);
  });

  it('S4 -- W3c: the pre-existing positive criteria still work after the unresolved-tracking refactor', async () => {
    spatialAuditMock.runSpatialAudit.mockResolvedValueOnce(baseAudit({ isProtected: true }));
    const protectedRes = await classifyProjectRegulatoryTrack({ lat: 1, lng: 2, ewcCode: '17 05 04', annualVolume: 10 });
    expect(protectedRes.isSensitiveArea).toBe(true);
    expect(protectedRes.spatialDataUnresolved).toEqual([]);

    spatialAuditMock.runSpatialAudit.mockResolvedValueOnce(
      baseAudit({ distanceToWaterMeters: 50, distanceToWaterAvailable: true }),
    );
    const nearWaterRes = await classifyProjectRegulatoryTrack({ lat: 1, lng: 2, ewcCode: '17 05 04', annualVolume: 10 });
    expect(nearWaterRes.isSensitiveArea).toBe(true);
    expect(nearWaterRes.spatialDataUnresolved).toEqual([]);

    spatialAuditMock.runSpatialAudit.mockResolvedValueOnce(baseAudit({ sgu: { riskLevel: 'HIGH', flags: [] } }));
    const highSoilRes = await classifyProjectRegulatoryTrack({ lat: 1, lng: 2, ewcCode: '17 05 04', annualVolume: 10 });
    expect(highSoilRes.isSensitiveArea).toBe(true);
    expect(highSoilRes.spatialDataUnresolved).toEqual([]);
  });

  it('W3c: fully resolved, genuinely clean data reports no unresolved items and is not sensitive', async () => {
    spatialAuditMock.runSpatialAudit.mockResolvedValueOnce(baseAudit());

    const res = await classifyProjectRegulatoryTrack({ lat: 1, lng: 2, ewcCode: '17 05 04', annualVolume: 10 });

    expect(res.spatialDataUnresolved).toEqual([]);
    expect(res.isSensitiveArea).toBe(false);
  });
});
