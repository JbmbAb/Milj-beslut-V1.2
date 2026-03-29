import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Prisma mock ─────────────────────────────────────────────────────────────

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

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('auditRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('writePropertyAccessLog', () => {
    it('creates a property access log entry', async () => {
      mocks.propertyAccessLogCreate.mockResolvedValue({ id: 'log-1' });

      await writePropertyAccessLog({
        userId: 'user-1',
        projectId: 'proj-1',
        propertyDesignation: 'Stockholm Centrum 1:1',
        purpose: 'ENV_PERMIT',
        responseClass: 'geometry',
      });

      expect(mocks.propertyAccessLogCreate).toHaveBeenCalledOnce();
      expect(mocks.propertyAccessLogCreate).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          projectId: 'proj-1',
          propertyDesignation: 'Stockholm Centrum 1:1',
          purpose: 'ENV_PERMIT',
          responseClass: 'geometry',
        },
      });
    });

    it('propagates prisma errors', async () => {
      mocks.propertyAccessLogCreate.mockRejectedValue(new Error('DB error'));

      await expect(
        writePropertyAccessLog({
          userId: 'user-1',
          projectId: 'proj-1',
          propertyDesignation: 'X',
          purpose: 'TEST',
          responseClass: 'boundaries',
        }),
      ).rejects.toThrow('DB error');
    });
  });

  describe('getAuditExportRows', () => {
    it('returns rows ordered by timestamp ascending', async () => {
      const rows = [
        { id: 'a1', entityType: 'DOCUMENT', entityId: 'd1', action: 'UPLOAD', timestamp: new Date() },
        { id: 'a2', entityType: 'PROJECT', entityId: 'p1', action: 'CREATE', timestamp: new Date() },
      ];
      mocks.auditTrailFindMany.mockResolvedValue(rows);

      const result = await getAuditExportRows(100);

      expect(mocks.auditTrailFindMany).toHaveBeenCalledWith({
        orderBy: [{ timestamp: 'asc' }, { id: 'asc' }],
        take: 100,
      });
      expect(result).toHaveLength(2);
    });

    it('uses default limit of 5000', async () => {
      mocks.auditTrailFindMany.mockResolvedValue([]);

      await getAuditExportRows();

      expect(mocks.auditTrailFindMany).toHaveBeenCalledWith(expect.objectContaining({ take: 5000 }));
    });
  });

  describe('getLatestAuditRow', () => {
    it('returns the latest row by timestamp desc', async () => {
      const row = { id: 'a1', timestamp: new Date(), chainHash: 'abc' };
      mocks.auditTrailFindFirst.mockResolvedValue(row);

      const result = await getLatestAuditRow();

      expect(mocks.auditTrailFindFirst).toHaveBeenCalledWith({
        orderBy: [{ timestamp: 'desc' }, { id: 'desc' }],
      });
      expect(result).toBe(row);
    });

    it('returns null when audit trail is empty', async () => {
      mocks.auditTrailFindFirst.mockResolvedValue(null);

      const result = await getLatestAuditRow();
      expect(result).toBeNull();
    });
  });

  describe('appendAuditTrailRow', () => {
    it('writes a complete audit trail row', async () => {
      mocks.auditTrailCreate.mockResolvedValue({ id: 'row-1' });

      const now = new Date();
      await appendAuditTrailRow({
        entityType: 'DOCUMENT',
        entityId: 'doc-1',
        action: 'UPLOAD',
        userId: 'user-1',
        timestamp: now,
        payloadHash: 'hash-abc',
        prevHash: null,
        chainHash: 'chain-hash',
      });

      expect(mocks.auditTrailCreate).toHaveBeenCalledWith({
        data: {
          entityType: 'DOCUMENT',
          entityId: 'doc-1',
          action: 'UPLOAD',
          userId: 'user-1',
          timestamp: now,
          payloadHash: 'hash-abc',
          prevHash: null,
          chainHash: 'chain-hash',
        },
      });
    });

    it('supports anonymous actions (no userId)', async () => {
      mocks.auditTrailCreate.mockResolvedValue({ id: 'row-2' });

      await appendAuditTrailRow({
        entityType: 'SYSTEM',
        entityId: 'sys-1',
        action: 'STARTUP',
        userId: undefined,
        timestamp: new Date(),
        payloadHash: 'h',
        prevHash: 'prev',
        chainHash: 'chain',
      });

      expect(mocks.auditTrailCreate).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ userId: undefined }) }),
      );
    });
  });
});
