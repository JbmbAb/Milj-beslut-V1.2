import { beforeEach, describe, expect, it, vi } from 'vitest';

const prisma = vi.hoisted(() => ({
  propertyAccessLog: {
    create: vi.fn(),
  },
  auditTrail: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
  },
}));

vi.mock('../../server/db/prisma', () => ({ prisma }));

import {
  appendAuditTrailRow,
  getAuditExportRows,
  getLatestAuditRow,
  writePropertyAccessLog,
} from '../../server/repositories/auditRepository';

describe('auditRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('writes property access log rows', async () => {
    prisma.propertyAccessLog.create.mockResolvedValue({ id: 'log-1' });

    await writePropertyAccessLog({
      userId: 'user-1',
      projectId: 'project-1',
      propertyDesignation: 'Orsa 1:1',
      purpose: 'lookup',
      responseClass: 'geometry',
    });

    expect(prisma.propertyAccessLog.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-1',
        projectId: 'project-1',
        propertyDesignation: 'Orsa 1:1',
        purpose: 'lookup',
        responseClass: 'geometry',
      },
    });
  });

  it('loads audit export rows with default limit ordering', async () => {
    prisma.auditTrail.findMany.mockResolvedValue([{ id: 'audit-1' }]);

    await expect(getAuditExportRows()).resolves.toEqual([{ id: 'audit-1' }]);
    expect(prisma.auditTrail.findMany).toHaveBeenCalledWith({
      orderBy: [{ timestamp: 'asc' }, { id: 'asc' }],
      take: 5000,
    });
  });

  it('loads the latest audit row with descending ordering', async () => {
    prisma.auditTrail.findFirst.mockResolvedValue({ id: 'audit-latest' });

    await expect(getLatestAuditRow()).resolves.toEqual({ id: 'audit-latest' });
    expect(prisma.auditTrail.findFirst).toHaveBeenCalledWith({
      orderBy: [{ timestamp: 'desc' }, { id: 'desc' }],
    });
  });

  it('appends audit trail rows', async () => {
    prisma.auditTrail.create.mockResolvedValue({ id: 'audit-2' });

    const timestamp = new Date('2026-03-22T13:00:00.000Z');
    await appendAuditTrailRow({
      entityType: 'PROJECT',
      entityId: 'project-1',
      action: 'UPDATED',
      userId: 'user-2',
      timestamp,
      payloadHash: 'payload-hash',
      prevHash: 'prev-hash',
      chainHash: 'chain-hash',
    });

    expect(prisma.auditTrail.create).toHaveBeenCalledWith({
      data: {
        entityType: 'PROJECT',
        entityId: 'project-1',
        action: 'UPDATED',
        userId: 'user-2',
        timestamp,
        payloadHash: 'payload-hash',
        prevHash: 'prev-hash',
        chainHash: 'chain-hash',
      },
    });
  });
});
