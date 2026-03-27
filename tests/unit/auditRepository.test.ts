import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  propertyAccessLogCreate: vi.fn(),
  auditTrailFindMany: vi.fn(),
  auditTrailFindFirst: vi.fn(),
  auditTrailCreate: vi.fn(),
}));

vi.mock('../../server/db/prisma', () => ({
  prisma: {
    propertyAccessLog: {
      create: mocks.propertyAccessLogCreate,
    },
    auditTrail: {
      findMany: mocks.auditTrailFindMany,
      findFirst: mocks.auditTrailFindFirst,
      create: mocks.auditTrailCreate,
    },
  },
}));

import {
  appendAuditTrailRow,
  getAuditExportRows,
  getLatestAuditRow,
  writePropertyAccessLog,
} from '../../server/repositories/auditRepository';

beforeEach(() => {
  vi.resetAllMocks();
});

describe('writePropertyAccessLog', () => {
  it('calls prisma.propertyAccessLog.create with the event fields', async () => {
    mocks.propertyAccessLogCreate.mockResolvedValue(undefined);

    await writePropertyAccessLog({
      userId: 'user-1',
      projectId: 'project-1',
      propertyDesignation: 'Test 1:1',
      purpose: 'inspection',
      responseClass: 'success',
    });

    expect(mocks.propertyAccessLogCreate).toHaveBeenCalledOnce();
    expect(mocks.propertyAccessLogCreate).toHaveBeenCalledWith({
      data: {
        userId: 'user-1',
        projectId: 'project-1',
        propertyDesignation: 'Test 1:1',
        purpose: 'inspection',
        responseClass: 'success',
      },
    });
  });

  it('propagates errors thrown by prisma', async () => {
    mocks.propertyAccessLogCreate.mockRejectedValue(new Error('db error'));

    await expect(
      writePropertyAccessLog({
        userId: 'u',
        projectId: 'p',
        propertyDesignation: 'X 1:1',
        purpose: 'test',
        responseClass: 'error',
      }),
    ).rejects.toThrow('db error');
  });
});

describe('getAuditExportRows', () => {
  it('returns rows ordered by timestamp asc with default limit 5000', async () => {
    const rows = [
      { id: 'a1', timestamp: new Date('2026-01-01') },
      { id: 'a2', timestamp: new Date('2026-01-02') },
    ];
    mocks.auditTrailFindMany.mockResolvedValue(rows);

    const result = await getAuditExportRows();

    expect(mocks.auditTrailFindMany).toHaveBeenCalledWith({
      orderBy: [{ timestamp: 'asc' }, { id: 'asc' }],
      take: 5000,
    });
    expect(result).toEqual(rows);
  });

  it('respects a custom limit', async () => {
    mocks.auditTrailFindMany.mockResolvedValue([]);

    await getAuditExportRows(100);

    expect(mocks.auditTrailFindMany).toHaveBeenCalledWith({
      orderBy: [{ timestamp: 'asc' }, { id: 'asc' }],
      take: 100,
    });
  });
});

describe('getLatestAuditRow', () => {
  it('returns the most recent audit row', async () => {
    const row = { id: 'latest', timestamp: new Date('2026-03-10') };
    mocks.auditTrailFindFirst.mockResolvedValue(row);

    const result = await getLatestAuditRow();

    expect(mocks.auditTrailFindFirst).toHaveBeenCalledWith({
      orderBy: [{ timestamp: 'desc' }, { id: 'desc' }],
    });
    expect(result).toEqual(row);
  });

  it('returns null when there are no audit rows', async () => {
    mocks.auditTrailFindFirst.mockResolvedValue(null);

    const result = await getLatestAuditRow();

    expect(result).toBeNull();
  });
});

describe('appendAuditTrailRow', () => {
  it('calls prisma.auditTrail.create with all provided fields', async () => {
    mocks.auditTrailCreate.mockResolvedValue(undefined);

    const input = {
      entityType: 'project',
      entityId: 'proj-42',
      action: 'UPDATE',
      userId: 'user-7',
      timestamp: new Date('2026-03-15T12:00:00.000Z'),
      payloadHash: 'abc123',
      prevHash: 'def456',
      chainHash: 'ghi789',
    };

    await appendAuditTrailRow(input);

    expect(mocks.auditTrailCreate).toHaveBeenCalledOnce();
    expect(mocks.auditTrailCreate).toHaveBeenCalledWith({ data: input });
  });

  it('handles null prevHash correctly', async () => {
    mocks.auditTrailCreate.mockResolvedValue(undefined);

    await appendAuditTrailRow({
      entityType: 'document',
      entityId: 'doc-1',
      action: 'CREATE',
      timestamp: new Date(),
      payloadHash: 'h1',
      prevHash: null,
      chainHash: 'h2',
    });

    const callArg = mocks.auditTrailCreate.mock.calls[0][0];
    expect(callArg.data.prevHash).toBeNull();
  });

  it('omits userId when not provided', async () => {
    mocks.auditTrailCreate.mockResolvedValue(undefined);

    await appendAuditTrailRow({
      entityType: 'user',
      entityId: 'u-99',
      action: 'DELETE',
      timestamp: new Date(),
      payloadHash: 'ph',
      prevHash: null,
      chainHash: 'ch',
    });

    const callArg = mocks.auditTrailCreate.mock.calls[0][0];
    expect(callArg.data.userId).toBeUndefined();
  });
});
