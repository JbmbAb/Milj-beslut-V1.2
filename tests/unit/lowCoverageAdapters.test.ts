import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  submission: { findUnique: vi.fn() },
  project: { findUnique: vi.fn(), findMany: vi.fn(), count: vi.fn() },
  transportBooking: { findMany: vi.fn(), count: vi.fn() },
  caseSnapshot: { findMany: vi.fn() },
  evidenceExport: { findFirst: vi.fn(), count: vi.fn() },
  requirementCase: { findFirst: vi.fn() },
  judgmentRecord: { findMany: vi.fn(), count: vi.fn() },
  legalSourceRecord: { findMany: vi.fn(), count: vi.fn() },
  $queryRaw: vi.fn(),
}));

vi.mock('../../server/db/prisma', () => ({
  prisma: prismaMock,
}));

import { getSubmissionOrgAndProjectByKey } from '../../server/modules/sewage/adapters/submissionLookup';
import {
  countAllProjects,
  getProjectBasicForSewage,
  listProjectsSewagePage,
} from '../../server/modules/platform/adapters/sewageApplicationList';
import {
  getProjectEnvironmentalOnly,
  getProjectForCarbonView,
  getProjectForPlanHeader,
} from '../../server/modules/platform/adapters/projectReads';
import {
  countProjectsForOrganisation,
  countTransportBookings,
  listProjectsPageForOrganisation,
  listTransportBookingsPage,
} from '../../server/modules/platform/adapters/adminLists';
import { listCaseSnapshots } from '../../server/modules/evidence/queries/listCaseSnapshots';
import { getExportManifest } from '../../server/modules/evidence/queries/getExportManifest';
import {
  countEvidenceExportsForCase,
  resolveRequirementCaseIdForProject,
  resolveRequirementCaseIdForSubmission,
} from '../../server/modules/evidence/queries/resolveRequirementCase';
import { getPostgisExtendedHealth } from '../../server/modules/gis/adapters/postgisHealth';
import {
  listJudgmentRecordsPage,
  listLegalSourceRecordsPage,
} from '../../server/modules/legal/adapters/legalRecordsStore';

describe('low coverage adapters/queries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('getSubmissionOrgAndProjectByKey queries Prisma with select', async () => {
    prismaMock.submission.findUnique.mockResolvedValueOnce({
      projectId: 'p1',
      organisationId: 'o1',
    });

    await expect(getSubmissionOrgAndProjectByKey('sub-1')).resolves.toEqual({
      projectId: 'p1',
      organisationId: 'o1',
    });

    expect(prismaMock.submission.findUnique).toHaveBeenCalledWith({
      where: { submissionKey: 'sub-1' },
      select: { projectId: true, organisationId: true },
    });
  });

  it('project read adapters select specific fields', async () => {
    prismaMock.project.findUnique.mockResolvedValueOnce({ id: 'p', propertyDesignation: 'X' });
    await getProjectForPlanHeader('p');
    expect(prismaMock.project.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'p' },
        select: expect.objectContaining({
          id: true,
          propertyDesignation: true,
          status: true,
          createdAt: true,
        }),
      }),
    );

    prismaMock.project.findUnique.mockResolvedValueOnce({ id: 'p', environmentalScore: 1 });
    await getProjectForCarbonView('p');
    expect(prismaMock.project.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          environmentalScore: true,
          complianceScore: true,
          regulatoryRiskScore: true,
        }),
      }),
    );

    prismaMock.project.findUnique.mockResolvedValueOnce({ id: 'p', environmentalScore: 1 });
    await getProjectEnvironmentalOnly('p');
    expect(prismaMock.project.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        select: { id: true, environmentalScore: true },
      }),
    );
  });

  it('sewage application list adapters call count/findMany', async () => {
    prismaMock.project.count.mockResolvedValueOnce(7);
    await expect(countAllProjects()).resolves.toBe(7);

    prismaMock.project.findMany.mockResolvedValueOnce([]);
    await listProjectsSewagePage({ skip: 10, take: 5 });
    expect(prismaMock.project.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { createdAt: 'desc' },
        skip: 10,
        take: 5,
        select: expect.any(Object),
      }),
    );

    prismaMock.project.findUnique.mockResolvedValueOnce(null);
    await getProjectBasicForSewage('proj-1');
    expect(prismaMock.project.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'proj-1' },
        select: expect.any(Object),
      }),
    );
  });

  it('adminLists adapters scope to organisation and paginate', async () => {
    prismaMock.project.count.mockResolvedValueOnce(3);
    await expect(countProjectsForOrganisation('org-1')).resolves.toBe(3);
    expect(prismaMock.project.count).toHaveBeenCalledWith({ where: { organisationId: 'org-1' } });

    prismaMock.project.findMany.mockResolvedValueOnce([]);
    await listProjectsPageForOrganisation({ organisationId: 'org-1', skip: 5, take: 10 });
    expect(prismaMock.project.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organisationId: 'org-1' },
        skip: 5,
        take: 10,
      }),
    );

    prismaMock.transportBooking.count.mockResolvedValueOnce(9);
    await expect(countTransportBookings()).resolves.toBe(9);

    prismaMock.transportBooking.findMany.mockResolvedValueOnce([]);
    await listTransportBookingsPage({ skip: 0, take: 25 });
    expect(prismaMock.transportBooking.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 0,
        take: 25,
        select: expect.any(Object),
      }),
    );
  });

  it('listCaseSnapshots validates id and stringifies createdAt', async () => {
    prismaMock.caseSnapshot.findMany.mockResolvedValueOnce([
      {
        id: 's1',
        requirementCaseId: 'c1',
        projectId: 'p1',
        organisationId: 'o1',
        snapshotType: 'type',
        snapshotVersion: 1,
        status: 'ok',
        createdBy: 'u1',
        createdAt: new Date('2026-01-02T03:04:05.000Z'),
        auditAnchorHash: 'a',
        contentHash: 'c',
        auditTrailRowCountAtSnapshot: null,
      },
    ]);

    const res = await listCaseSnapshots({ requirementCaseId: 'c1', organisationId: 'o1' });
    expect(res[0]?.createdAt).toBe('2026-01-02T03:04:05.000Z');
  });

  it('listCaseSnapshots throws on missing requirementCaseId', async () => {
    await expect(listCaseSnapshots({ requirementCaseId: '   ', organisationId: 'o1' })).rejects.toThrow(
      'requirementCaseId required',
    );
  });

  it('getExportManifest validates exportId and returns stored manifest', async () => {
    prismaMock.evidenceExport.findFirst.mockResolvedValueOnce({ manifest: { hello: 'world' } });
    await expect(getExportManifest({ exportId: 'exp-1', organisationId: 'org-1' })).resolves.toEqual({
      hello: 'world',
    });
  });

  it('getExportManifest throws for missing id / missing row', async () => {
    await expect(getExportManifest({ exportId: '  ', organisationId: 'org-1' })).rejects.toThrow(
      'exportId required',
    );
    prismaMock.evidenceExport.findFirst.mockResolvedValueOnce(null);
    await expect(getExportManifest({ exportId: 'exp-404', organisationId: 'org-1' })).rejects.toThrow(
      'Export not found',
    );
  });

  it('resolveRequirementCaseIdForProject picks latest updated', async () => {
    prismaMock.requirementCase.findFirst.mockResolvedValueOnce({ id: 'case-1' });
    await expect(resolveRequirementCaseIdForProject({ projectId: 'p1', organisationId: 'o1' })).resolves.toBe(
      'case-1',
    );
    expect(prismaMock.requirementCase.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { projectId: 'p1', organisationId: 'o1' },
        select: { id: true },
      }),
    );
  });

  it('resolveRequirementCaseIdForSubmission uses provided id if valid, else falls back to project lookup', async () => {
    prismaMock.requirementCase.findFirst
      .mockResolvedValueOnce({ id: 'case-2' }) // by id check
      .mockResolvedValueOnce({ id: 'case-3' }); // fallback

    await expect(
      resolveRequirementCaseIdForSubmission({
        requirementCaseId: 'case-2',
        projectId: 'p1',
        organisationId: 'o1',
      }),
    ).resolves.toBe('case-2');

    prismaMock.requirementCase.findFirst.mockResolvedValueOnce(null);
    prismaMock.requirementCase.findFirst.mockResolvedValueOnce({ id: 'case-3' });
    await expect(
      resolveRequirementCaseIdForSubmission({
        requirementCaseId: 'missing',
        projectId: 'p1',
        organisationId: 'o1',
      }),
    ).resolves.toBe('case-3');
  });

  it('countEvidenceExportsForCase proxies to Prisma count', async () => {
    prismaMock.evidenceExport.count.mockResolvedValueOnce(12);
    await expect(countEvidenceExportsForCase('case-1')).resolves.toBe(12);
    expect(prismaMock.evidenceExport.count).toHaveBeenCalledWith({ where: { requirementCaseId: 'case-1' } });
  });

  it('getPostgisExtendedHealth aggregates $queryRaw results', async () => {
    prismaMock.$queryRaw
      .mockResolvedValueOnce([{ postgis_full_version: 'POSTGIS 3.4.0' }])
      .mockResolvedValueOnce([{ count: BigInt(2) }])
      .mockResolvedValueOnce([{ count: BigInt(5) }])
      .mockResolvedValueOnce([{ extname: 'postgis', extversion: '3.4.0' }])
      .mockResolvedValueOnce([
        { fileName: '001.sql', appliedAt: new Date('2026-01-01T00:00:00.000Z'), durationMs: 1 },
      ]);

    const health = await getPostgisExtendedHealth();
    expect(health.postgis.version).toBe('POSTGIS 3.4.0');
    expect(health.postgis.sridCount).toBe(2);
    expect(health.postgis.gistIndexCount).toBe(5);
    expect(health.extensions[0]?.extname).toBe('postgis');
    expect(health.lastSpatialMigration?.fileName).toBe('001.sql');
    expect(typeof health.checkedAt).toBe('string');
  });

  it('legalRecordsStore returns page + total for judgment and legal source', async () => {
    prismaMock.judgmentRecord.findMany.mockResolvedValueOnce([{ id: 'j1' }]);
    prismaMock.judgmentRecord.count.mockResolvedValueOnce(2);
    const judgments = await listJudgmentRecordsPage({
      where: {},
      orderBy: [{ createdAt: 'desc' }],
      skip: 0,
      take: 10,
    } as any);
    expect(judgments).toEqual({ items: [{ id: 'j1' }], total: 2 });

    prismaMock.legalSourceRecord.findMany.mockResolvedValueOnce([{ id: 'l1' }]);
    prismaMock.legalSourceRecord.count.mockResolvedValueOnce(3);
    const sources = await listLegalSourceRecordsPage({
      where: {},
      orderBy: [{ createdAt: 'desc' }],
      skip: 5,
      take: 5,
    } as any);
    expect(sources).toEqual({ items: [{ id: 'l1' }], total: 3 });
  });
});
