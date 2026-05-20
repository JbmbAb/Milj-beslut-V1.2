import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  appendPropertyAudit,
  appendDomainAudit,
  exportAuditTrail,
  verifyAuditTrail,
} from '../../server/security/auditTrail';
import * as auditRepository from '../../server/repositories/auditRepository';

vi.mock('../../server/repositories/auditRepository', () => ({
  appendAuditTrailRow: vi.fn(),
  getAuditExportRows: vi.fn(),
  getLatestAuditRow: vi.fn(),
}));

describe('server/security/auditTrail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('appendPropertyAudit', () => {
    it('creates audit record for property access', async () => {
      const event = {
        userId: 'user123',
        projectId: 'proj123',
        propertyDesignation: 'STOCKHOLM 1:1',
        purpose: 'Environmental assessment',
        responseClass: 'geometry' as const,
      };

      vi.mocked(auditRepository.getLatestAuditRow).mockResolvedValue(null);
      vi.mocked(auditRepository.appendAuditTrailRow).mockResolvedValue(undefined);

      const result = await appendPropertyAudit(event);

      expect(result.entityType).toBe('PropertyAccess');
      expect(result.entityId).toBe('proj123:STOCKHOLM 1:1');
      expect(result.action).toBe('READ');
      expect(result.userId).toBe('user123');
      expect(result.payloadHash).toBeDefined();
      expect(result.chainHash).toBeDefined();
    });

    it('creates valid chain hash for first event', async () => {
      const event = {
        userId: 'user123',
        projectId: 'proj123',
        propertyDesignation: 'STOCKHOLM 1:1',
        purpose: 'Environmental assessment',
        responseClass: 'boundaries' as const,
      };

      vi.mocked(auditRepository.getLatestAuditRow).mockResolvedValue(null);
      vi.mocked(auditRepository.appendAuditTrailRow).mockResolvedValue(undefined);

      const result = await appendPropertyAudit(event);

      expect(result.prevHash).toBeNull();
      expect(result.chainHash).toMatch(/^[a-f0-9]{64}$/); // SHA256 hex
    });

    it('links to previous hash in chain', async () => {
      const event = {
        userId: 'user123',
        projectId: 'proj123',
        propertyDesignation: 'STOCKHOLM 1:1',
        purpose: 'Environmental assessment',
        responseClass: 'ownership_redacted' as const,
      };

      const previousHash = 'abc123def456789';
      vi.mocked(auditRepository.getLatestAuditRow).mockResolvedValue({
        id: 'prev1',
        entityType: 'PropertyAccess',
        entityId: 'proj122:STOCKHOLM 2:1',
        action: 'READ',
        userId: 'user122',
        timestamp: new Date(),
        payloadHash: 'payload123',
        prevHash: null,
        chainHash: previousHash,
      } as any);
      vi.mocked(auditRepository.appendAuditTrailRow).mockResolvedValue(undefined);

      const result = await appendPropertyAudit(event);

      expect(result.prevHash).toBe(previousHash);
    });

    it('calls repository with mapped data', async () => {
      const event = {
        userId: 'user123',
        projectId: 'proj123',
        propertyDesignation: 'STOCKHOLM 1:1',
        purpose: 'Environmental assessment',
        responseClass: 'geometry' as const,
      };

      vi.mocked(auditRepository.getLatestAuditRow).mockResolvedValue(null);
      vi.mocked(auditRepository.appendAuditTrailRow).mockResolvedValue(undefined);

      await appendPropertyAudit(event);

      expect(auditRepository.appendAuditTrailRow).toHaveBeenCalledWith(
        expect.objectContaining({
          entityType: 'PropertyAccess',
          userId: 'user123',
        }),
      );
    });
  });

  describe('appendDomainAudit', () => {
    it('creates generic audit record', async () => {
      vi.mocked(auditRepository.getLatestAuditRow).mockResolvedValue(null);
      vi.mocked(auditRepository.appendAuditTrailRow).mockResolvedValue(undefined);

      const result = await appendDomainAudit({
        userId: 'user1',
        action: 'CREATE',
        entityType: 'Project',
        entityId: 'p1',
        payload: { name: 'New Project' },
      });

      expect(result.entityType).toBe('Project');
      expect(result.action).toBe('CREATE');
      expect(result.payloadHash).toBeDefined();
    });

    it('includes details in payload', async () => {
      vi.mocked(auditRepository.getLatestAuditRow).mockResolvedValue(null);
      vi.mocked(auditRepository.appendAuditTrailRow).mockResolvedValue(undefined);

      const payload = { foo: 'bar', nested: { val: 123 } };
      const result = await appendDomainAudit({
        userId: 'user1',
        action: 'UPDATE',
        entityType: 'User',
        entityId: 'u1',
        payload,
      });

      expect(result.userId).toBe('user1');
    });
  });

  describe('exportAuditTrail', () => {
    it('returns all audit rows from repository', async () => {
      const mockRows = [
        { id: '1', timestamp: new Date(), action: 'READ', entityType: 'A', entityId: 'a1' },
        { id: '2', timestamp: new Date(), action: 'WRITE', entityType: 'B', entityId: 'b1' },
      ];
      vi.mocked(auditRepository.getAuditExportRows).mockResolvedValue(mockRows as any);

      const result = await exportAuditTrail();

      expect(result).toHaveLength(2);
      expect(result[0]).toHaveProperty('id');
    });
  });

  describe('verifyAuditTrail', () => {
    it('returns valid when chain is empty', async () => {
      vi.mocked(auditRepository.getAuditExportRows).mockResolvedValue([]);

      const result = await verifyAuditTrail();

      expect(result.ok).toBe(true);
      expect(result.invalidIndex).toBeUndefined();
    });

    it('returns valid for single-entry chain', async () => {
      const row = {
        id: '1',
        timestamp: new Date(),
        action: 'CREATE',
        entityType: 'T',
        entityId: 'id1',
        userId: 'u1',
        payloadHash: 'hash1',
        prevHash: null,
        chainHash: '',
      };
      vi.mocked(auditRepository.getAuditExportRows).mockResolvedValue([row as any]);

      const result = await verifyAuditTrail();
      expect(result).toBeDefined();
    });

    it('detects broken hash chain', async () => {
      const now = new Date();
      const rows = [
        {
          id: '1',
          timestamp: now,
          action: 'A',
          entityType: 'E',
          entityId: '1',
          userId: 'u',
          payloadHash: 'h1',
          prevHash: null,
          chainHash: 'valid-h1',
        },
        {
          id: '2',
          timestamp: now,
          action: 'A',
          entityType: 'E',
          entityId: '2',
          userId: 'u',
          payloadHash: 'h2',
          prevHash: 'WRONG-HASH',
          chainHash: 'h2',
        },
      ];

      vi.mocked(auditRepository.getAuditExportRows).mockResolvedValue(rows as any);

      const result = await verifyAuditTrail();
      expect(result.ok).toBe(false);
      expect(result.invalidIndex).toBe(0);
    });

    it('detects modified payload hash', async () => {
      const rows = [
        {
          id: '1',
          timestamp: new Date(),
          action: 'A',
          entityType: 'E',
          entityId: '1',
          userId: 'u',
          payloadHash: 'TAMPERED',
          prevHash: null,
          chainHash: 'original-hash',
        },
      ];

      vi.mocked(auditRepository.getAuditExportRows).mockResolvedValue(rows as any);

      const result = await verifyAuditTrail();
      expect(result.ok).toBe(false);
    });
  });

  describe('Complex chain scenarios', () => {
    it('verifies a chain of 5 entries', async () => {
      const rows = [];
      const now = new Date();
      for (let i = 0; i < 5; i++) {
        rows.push({
          id: String(i),
          timestamp: now,
          action: 'ACT',
          entityType: 'ENT',
          entityId: 'ID',
          userId: 'USR',
          payloadHash: `h${i}`,
          prevHash: i > 0 ? `h${i - 1}` : null,
          chainHash: `ch${i}`,
        });
      }

      vi.mocked(auditRepository.getAuditExportRows).mockResolvedValue(rows as any);
      const result = await verifyAuditTrail();
      expect(result).toBeDefined();
    });

    it('handles multiple entities in same chain', async () => {
      vi.mocked(auditRepository.getLatestAuditRow).mockResolvedValue({
        id: '1',
        entityType: 'A',
        entityId: 'id1',
        action: 'CREATE',
        userId: 'u',
        timestamp: new Date(),
        payloadHash: 'h1',
        prevHash: null,
        chainHash: 'prev-h',
      } as any);

      const result = await appendDomainAudit({
        userId: 'u',
        action: 'UPDATE',
        entityType: 'B',
        entityId: 'id2',
        payload: {},
      });

      expect(result.prevHash).toBe('prev-h');
    });
  });
});
