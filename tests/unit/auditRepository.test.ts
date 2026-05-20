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
      responseClass: 'geometry',
    });

    expect(mocks.propertyAccessLogCreate).toHaveBeenCalledOnce();
    expect(mocks.propertyAccessLogCreate).toHaveBeenCalledWith({
      data: {
        userId: 'user-1',
        projectId: 'project-1',
        propertyDesignation: 'Test 1:1',
        purpose: 'inspection',
        responseClass: 'geometry',
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
        responseClass: 'boundaries',
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

// Additional tests for 100% coverage
describe('auditRepository - Error Handling & Edge Cases', () => {
  describe('getAuditExportRows (error handling)', () => {
    it('propagates database errors from prisma', async () => {
      mocks.auditTrailFindMany.mockRejectedValue(new Error('connection timeout'));

      await expect(getAuditExportRows(500)).rejects.toThrow('connection timeout');
    });

    it('handles empty audit trail', async () => {
      mocks.auditTrailFindMany.mockResolvedValue([]);

      const result = await getAuditExportRows();

      expect(result).toEqual([]);
    });

    it('returns large result set correctly', async () => {
      const largeSet = Array.from({ length: 5000 }, (_, i) => ({
        id: `audit-${i}`,
        timestamp: new Date(),
      }));
      mocks.auditTrailFindMany.mockResolvedValue(largeSet);

      const result = await getAuditExportRows(5000);

      expect(result).toHaveLength(5000);
    });
  });

  describe('getLatestAuditRow (error handling)', () => {
    it('propagates database errors from prisma', async () => {
      mocks.auditTrailFindFirst.mockRejectedValue(new Error('db unavailable'));

      await expect(getLatestAuditRow()).rejects.toThrow('db unavailable');
    });

    it('handles empty result gracefully', async () => {
      mocks.auditTrailFindFirst.mockResolvedValue(null);

      const result = await getLatestAuditRow();

      expect(result).toBeNull();
    });
  });

  describe('writePropertyAccessLog (error handling)', () => {
    it('propagates database constraint errors', async () => {
      mocks.propertyAccessLogCreate.mockRejectedValue(new Error('unique constraint violation'));

      await expect(
        writePropertyAccessLog({
          userId: 'user-1',
          projectId: 'project-1',
          propertyDesignation: 'Samma 1:1',
          purpose: 'inspection',
          responseClass: 'geometry',
        }),
      ).rejects.toThrow('unique constraint violation');
    });

    it('handles Swedish property designations', async () => {
      mocks.propertyAccessLogCreate.mockResolvedValue(undefined);

      await writePropertyAccessLog({
        userId: 'user-1',
        projectId: 'project-1',
        propertyDesignation: 'STOCKHOLM 1:1',
        purpose: 'inspektöring',
        responseClass: 'boundaries',
      });

      expect(mocks.propertyAccessLogCreate).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          projectId: 'project-1',
          propertyDesignation: 'STOCKHOLM 1:1',
          purpose: 'inspektöring',
          responseClass: 'boundaries',
        },
      });
    });
  });

  describe('appendAuditTrailRow (error handling & edge cases)', () => {
    it('propagates database errors during creation', async () => {
      mocks.auditTrailCreate.mockRejectedValue(new Error('foreign key constraint'));

      await expect(
        appendAuditTrailRow({
          entityType: 'projekt',
          entityId: 'proj-999',
          action: 'UPDATE',
          userId: 'invalid-user',
          timestamp: new Date(),
          payloadHash: 'h1',
          prevHash: null,
          chainHash: 'h2',
        }),
      ).rejects.toThrow('foreign key constraint');
    });

    it('handles empty strings in required fields', async () => {
      mocks.auditTrailCreate.mockResolvedValue({
        id: 'audit-empty',
        entityType: '',
        entityId: '',
        action: '',
        timestamp: new Date(),
      });

      await appendAuditTrailRow({
        entityType: '',
        entityId: '',
        action: '',
        timestamp: new Date(),
        payloadHash: '',
        prevHash: null,
        chainHash: '',
      });

      expect(mocks.auditTrailCreate).toHaveBeenCalledOnce();
    });

    it('handles very long hash values', async () => {
      const longHash = 'a'.repeat(10000);
      mocks.auditTrailCreate.mockResolvedValue(undefined);

      await appendAuditTrailRow({
        entityType: 'entity',
        entityId: 'id-long',
        action: 'ACTION',
        userId: 'user-xyz',
        timestamp: new Date(),
        payloadHash: longHash,
        prevHash: longHash,
        chainHash: longHash,
      });

      expect(mocks.auditTrailCreate).toHaveBeenCalled();
    });

    it('handles multiple sequential creations', async () => {
      mocks.auditTrailCreate.mockResolvedValue(undefined);

      for (let i = 0; i < 5; i++) {
        await appendAuditTrailRow({
          entityType: 'project',
          entityId: `proj-${i}`,
          action: 'CREATE',
          timestamp: new Date(),
          payloadHash: `hash-${i}`,
          prevHash: i > 0 ? `hash-${i - 1}` : null,
          chainHash: `chain-${i}`,
        });
      }

      expect(mocks.auditTrailCreate).toHaveBeenCalledTimes(5);
    });
  });
});
