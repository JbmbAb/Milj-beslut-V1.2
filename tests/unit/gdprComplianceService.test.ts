import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auditTrailUpdateMany: vi.fn(),
  cleanupExpiredTokenRevocations: vi.fn(),
  projectMemberDeleteMany: vi.fn(),
  projectMemberFindMany: vi.fn(),
  projectUpdate: vi.fn(),
  projectUpdateMany: vi.fn(),
  propertyAccessLogDeleteMany: vi.fn(),
  searchQueryLogDeleteMany: vi.fn(),
  tokenRevocationDeleteMany: vi.fn(),
  userDelete: vi.fn(),
  userFindUnique: vi.fn(),
}));

vi.mock('../../server/db/prisma', () => ({
  prisma: {
    auditTrail: {
      updateMany: mocks.auditTrailUpdateMany,
    },
    project: {
      update: mocks.projectUpdate,
      updateMany: mocks.projectUpdateMany,
    },
    projectMember: {
      deleteMany: mocks.projectMemberDeleteMany,
      findMany: mocks.projectMemberFindMany,
    },
    propertyAccessLog: {
      deleteMany: mocks.propertyAccessLogDeleteMany,
      findMany: vi.fn(),
    },
    searchQueryLog: {
      deleteMany: mocks.searchQueryLogDeleteMany,
      findMany: vi.fn(),
    },
    tokenRevocation: {
      deleteMany: mocks.tokenRevocationDeleteMany,
    },
    user: {
      delete: mocks.userDelete,
      findUnique: mocks.userFindUnique,
    },
  },
}));

vi.mock('../../server/repositories/tokenRepository', () => ({
  cleanupExpiredTokenRevocations: mocks.cleanupExpiredTokenRevocations,
}));

import { prisma } from '../../server/db/prisma';
import {
  archiveExpiredProjects,
  exportUserPersonalData,
  permanentlyDeleteUserData,
  runGdprMaintenanceJob,
  setProjectRetentionPolicy,
} from '../../server/services/gdprComplianceService';

describe('gdprComplianceService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sets retention dates on projects', async () => {
    mocks.projectUpdate.mockResolvedValueOnce({});
    const before = Date.now();

    await setProjectRetentionPolicy('project-1', 30);

    const after = Date.now();
    expect(mocks.projectUpdate).toHaveBeenCalledWith({
      where: { id: 'project-1' },
      data: {
        retentionUntil: expect.any(Date),
      },
    });
    const calledDate = mocks.projectUpdate.mock.calls[0]?.[0]?.data?.retentionUntil as Date;
    expect(calledDate.getTime()).toBeGreaterThanOrEqual(before + 29 * 24 * 60 * 60 * 1000);
    expect(calledDate.getTime()).toBeLessThanOrEqual(after + 31 * 24 * 60 * 60 * 1000);
  });

  it('archives expired closed projects and returns the affected count', async () => {
    mocks.projectUpdateMany.mockResolvedValueOnce({ count: 4 });

    await expect(archiveExpiredProjects()).resolves.toBe(4);
    expect(mocks.projectUpdateMany).toHaveBeenCalledWith({
      where: {
        status: 'CLOSED',
        retentionUntil: {
          lt: expect.any(Date),
        },
      },
      data: {
        status: 'ARCHIVED',
      },
    });
  });

  it('permanently deletes user data while preserving anonymized audit history', async () => {
    mocks.projectMemberFindMany.mockResolvedValueOnce([
      { projectId: 'project-1' },
      { projectId: 'project-2' },
    ]);
    mocks.auditTrailUpdateMany.mockResolvedValueOnce({ count: 5 });
    mocks.tokenRevocationDeleteMany.mockResolvedValueOnce({ count: 3 });
    mocks.projectMemberDeleteMany.mockResolvedValueOnce({ count: 2 });
    mocks.propertyAccessLogDeleteMany.mockResolvedValueOnce({ count: 7 });
    mocks.searchQueryLogDeleteMany.mockResolvedValueOnce({ count: 8 });
    mocks.userDelete.mockResolvedValueOnce({});

    const result = await permanentlyDeleteUserData('user-1');

    expect(result).toEqual({
      projectsDeleted: 2,
      auditLogsAnonymized: 5,
      tokensRevoked: 3,
    });
    expect(mocks.projectMemberDeleteMany).toHaveBeenCalledWith({ where: { userId: 'user-1' } });
    expect(mocks.propertyAccessLogDeleteMany).toHaveBeenCalledWith({ where: { userId: 'user-1' } });
    expect(mocks.searchQueryLogDeleteMany).toHaveBeenCalledWith({ where: { userId: 'user-1' } });
    expect(mocks.auditTrailUpdateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      data: { userId: null },
    });
    expect(mocks.userDelete).toHaveBeenCalledWith({ where: { id: 'user-1' } });
  });

  it('exports personal data and rejects missing users', async () => {
    mocks.userFindUnique.mockResolvedValueOnce(null);

    await expect(exportUserPersonalData('missing-user')).rejects.toThrow(/User not found/);

    mocks.userFindUnique.mockResolvedValueOnce({
      id: 'user-1',
      bankidId: '191212121212',
      role: 'ADMIN',
    });
    vi.mocked(prisma.projectMember.findMany).mockResolvedValueOnce([
      {
        project: {
          id: 'project-1',
          propertyDesignation: 'Orsa 1:1',
          status: 'ACTIVE',
          createdAt: new Date('2026-03-21T12:00:00.000Z'),
        },
      },
    ] as any);
    vi.mocked(prisma.propertyAccessLog.findMany).mockResolvedValueOnce([
      {
        id: 'log-1',
        propertyDesignation: 'Orsa 1:1',
        purpose: 'lookup',
        timestamp: new Date('2026-03-21T12:00:00.000Z'),
        responseClass: 'geometry',
      },
    ] as any);
    vi.mocked(prisma.searchQueryLog.findMany).mockResolvedValueOnce([
      {
        id: 'query-1',
        query: 'orsa massor',
        resultCount: 3,
        createdAt: new Date('2026-03-21T12:00:00.000Z'),
      },
    ] as any);

    const result = await exportUserPersonalData('user-1');

    expect(result).toEqual({
      user: {
        id: 'user-1',
        bankidId: '191212121212',
        role: 'ADMIN',
      },
      projects: [
        {
          project: {
            id: 'project-1',
            propertyDesignation: 'Orsa 1:1',
            status: 'ACTIVE',
            createdAt: new Date('2026-03-21T12:00:00.000Z'),
          },
        },
      ],
      accessLogs: [
        {
          id: 'log-1',
          propertyDesignation: 'Orsa 1:1',
          purpose: 'lookup',
          timestamp: new Date('2026-03-21T12:00:00.000Z'),
          responseClass: 'geometry',
        },
      ],
      searchQueries: [
        {
          id: 'query-1',
          query: 'orsa massor',
          resultCount: 3,
          createdAt: new Date('2026-03-21T12:00:00.000Z'),
        },
      ],
    });
  });

  it('runs GDPR maintenance jobs by combining token cleanup and archival', async () => {
    mocks.cleanupExpiredTokenRevocations.mockResolvedValueOnce(9);
    mocks.projectUpdateMany.mockResolvedValueOnce({ count: 4 });

    await expect(runGdprMaintenanceJob()).resolves.toEqual({
      tokensCleanedUp: 9,
      projectsArchived: 4,
    });
  });
});
