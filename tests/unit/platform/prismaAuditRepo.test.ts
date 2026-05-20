import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PrismaAuditRepository } from '../../../src/infrastructure/prisma-audit-repository';
import { prisma } from '../../../db.server';
import { AuditAction } from '../../../src/domain/audit';

vi.mock('../../../db.server', () => ({
  prisma: {
    auditTrail: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
  },
}));

describe('PrismaAuditRepository', () => {
  let repo: PrismaAuditRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = new PrismaAuditRepository();
  });

  it('should save an audit event', async () => {
    const event = {
      id: 'a1',
      timestamp: new Date(),
      userId: 'u1',
      action: AuditAction.CREATE,
      entityType: 'Project',
      entityId: 'p1',
      details: 'Test details',
    };

    (prisma.auditTrail.findFirst as any).mockResolvedValue(null);
    (prisma.auditTrail.create as any).mockResolvedValue({ ...event, chainHash: 'h1', payloadHash: 'p1' });

    await repo.save(event);

    expect(prisma.auditTrail.create).toHaveBeenCalled();
  });

  it('should find by entity', async () => {
    (prisma.auditTrail.findMany as any).mockResolvedValue([]);
    const results = await repo.findByEntity('Project', 'p1');
    expect(Array.isArray(results)).toBe(true);
    expect(prisma.auditTrail.findMany).toHaveBeenCalledWith({
      where: { entityType: 'Project', entityId: 'p1' },
      orderBy: { timestamp: 'desc' },
    });
  });
});
