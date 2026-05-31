import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  project: { findMany: vi.fn() },
  backgroundJob: { create: vi.fn(), update: vi.fn() },
}));

const loggerMock = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

const spatialAuditMock = vi.hoisted(() => ({
  runSpatialAudit: vi.fn(),
}));

const mpfMock = vi.hoisted(() => ({
  evaluateMpfOperation: vi.fn(),
}));

vi.mock('../../server/db/prisma', () => ({ prisma: prismaMock }));
vi.mock('../../server/logger', () => ({ logger: loggerMock }));
vi.mock('../../server/services/spatialAuditService', () => spatialAuditMock);
vi.mock('../../services/mpfEngine', () => mpfMock);

import {
  listAccessibleProjects,
  parseOptionalText,
  summarizeModuleAccess,
} from '../../server/routes/routeHelpers';
import { classifyProjectRegulatoryTrack } from '../../server/services/regulationOrchestrator';
import { syncMilestoneToErp } from '../../server/services/erpSyncService';
import { runReliableJob } from '../../server/services/BackgroundJobService';

describe('low coverage server helpers/services', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('summarizeModuleAccess sets enabled/status/reason based on role + project', () => {
    const res = summarizeModuleAccess({ activeProjectId: null, projectCount: 0, role: 'USER' });
    const admin = res.find((m) => m.id === 'admin');
    expect(admin?.enabled).toBe(false);
    expect(admin?.status).toBe('unavailable');
    expect(admin?.reason).toContain('Admin');

    const core = res.find((m) => m.id === 'core');
    expect(core?.enabled).toBe(false);
    expect(core?.status).toBe('unavailable');
    expect(core?.reason).toContain('Välj');
  });

  it('parseOptionalText returns undefined for blanks', () => {
    expect(parseOptionalText('')).toBeUndefined();
    expect(parseOptionalText('   ')).toBeUndefined();
    expect(parseOptionalText(null)).toBeUndefined();
    expect(parseOptionalText('x')).toBe('x');
  });

  it('listAccessibleProjects maps Prisma rows to bootstrap summaries', async () => {
    prismaMock.project.findMany.mockResolvedValueOnce([
      {
        id: 'p1',
        propertyDesignation: 'AAA 1:1',
        status: 'ACTIVE',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        complianceScore: 1,
        environmentalScore: 2,
        fundingRating: 'A',
        regulatoryRiskScore: 3,
        planState: { updatedAt: new Date('2026-01-02T00:00:00.000Z') },
        _count: { documents: 4, members: 5 },
      },
      {
        id: 'p2',
        propertyDesignation: 'BBB 2:2',
        status: 'ACTIVE',
        createdAt: new Date('2026-01-03T00:00:00.000Z'),
        complianceScore: null,
        environmentalScore: null,
        fundingRating: null,
        regulatoryRiskScore: null,
        planState: null,
        _count: { documents: 0, members: 1 },
      },
    ]);

    const res = await listAccessibleProjects({ userId: 'u1', organisationId: 'o1', role: 'USER' });
    expect(res).toHaveLength(2);
    expect(res[0]?.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(res[0]?.lastPlanUpdatedAt).toBe('2026-01-02T00:00:00.000Z');
    expect(res[1]?.lastPlanUpdatedAt).toBeNull();
    expect(prismaMock.project.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organisationId: 'o1' }),
        select: expect.any(Object),
      }),
    );
  });

  it('classifyProjectRegulatoryTrack marks sensitive area and builds summary', async () => {
    spatialAuditMock.runSpatialAudit.mockResolvedValueOnce({
      isProtected: true,
      distanceToWaterMeters: 10,
      sgu: { riskLevel: 'HIGH', groundLayer: { hit: { layerLabel: 'X' } } },
    });
    mpfMock.evaluateMpfOperation.mockReturnValueOnce({
      permitClass: 'C',
      notes: 'notes',
    });

    const res = await classifyProjectRegulatoryTrack({
      lat: 1,
      lng: 2,
      ewcCode: '17 05 04',
      annualVolume: 123,
    });
    expect(res.permitClass).toBe('C');
    expect(res.isSensitiveArea).toBe(true);
    expect(res.summary).toContain('känslig');
  });

  it('syncMilestoneToErp returns FAILED when ERP is not configured', async () => {
    vi.stubEnv('ERP_PROVIDER', '');
    vi.stubEnv('ERP_API_KEY', '');
    vi.stubEnv('ERP_ENDPOINT', '');
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);

    const tx = await syncMilestoneToErp('p1', 'm1', 'desc', 10);
    expect(tx.status).toBe('FAILED');
    expect(loggerMock.warn).toHaveBeenCalled();
  });

  it('syncMilestoneToErp returns SENT for mock providers', async () => {
    vi.stubEnv('ERP_PROVIDER', 'MOCK');
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_001);

    const tx = await syncMilestoneToErp('p1', 'm1', 'desc', 10);
    expect(tx.status).toBe('SENT');
    expect(tx.externalReference).toContain('ERP-');
  });

  it('runReliableJob persists state and returns task result', async () => {
    prismaMock.backgroundJob.create.mockResolvedValueOnce({ id: 'job-1' });
    prismaMock.backgroundJob.update.mockResolvedValue({ id: 'job-1' });

    const out = await runReliableJob('SEARCH_INDEXING', { a: 1 }, async () => ({ ok: true }));
    expect(out).toEqual({ ok: true });
    expect(prismaMock.backgroundJob.create).toHaveBeenCalled();
    expect(prismaMock.backgroundJob.update).toHaveBeenCalled();
  });

  it('runReliableJob marks failure and rethrows', async () => {
    prismaMock.backgroundJob.create.mockResolvedValueOnce({ id: 'job-2' });
    prismaMock.backgroundJob.update.mockResolvedValue({ id: 'job-2' });

    await expect(
      runReliableJob('AI_GENERATION', { a: 1 }, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(loggerMock.error).toHaveBeenCalled();
  });
});
