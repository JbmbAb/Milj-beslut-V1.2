import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PrismaRequirementRepository } from '../../../src/infrastructure/prisma-requirement-repository';
import { prisma } from '../../../db.server';

vi.mock('../../../db.server', () => ({
  prisma: {
    requirementRecord: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      upsert: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

describe('PrismaRequirementRepository', () => {
  let repo: PrismaRequirementRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = new PrismaRequirementRepository();
  });

  it('should find requirements by project', async () => {
    (prisma.requirementRecord.findMany as any).mockResolvedValue([
      {
        id: 'r1',
        projectId: 'p1',
        requirementCode: 'REQ-1',
        category: 'GENERAL',
        subcategory: 'SUB',
        requirementTextQuote: 'Test Req',
        interpretedRequirement: 'Test Req',
        level: 'MANDATORY',
        statusInNotification: 'PENDING',
        minimumRequirement: true,
        municipalitySpecific: false,
        documentId: 'doc-1',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    const results = await repo.findByProject('p1');

    expect(results.length).toBe(1);
    expect(prisma.requirementRecord.findMany).toHaveBeenCalledWith({
      where: { projectId: 'p1' },
    });
  });

  it('should save a requirement', async () => {
    const req = {
      id: 'r1',
      projectId: 'p1',
      title: 'Req',
      status: 'VERIFIED',
      level: 'MANDATORY',
      isMinimumRequirement: true,
      municipalitySpecific: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    (prisma.requirementRecord.upsert as any).mockResolvedValue({
      id: 'r1',
      projectId: 'p1',
      requirementCode: 'REQ-1',
      category: 'GENERAL',
      subcategory: 'SUB',
      requirementTextQuote: 'Req',
      interpretedRequirement: 'Req',
      level: 'MANDATORY',
      statusInNotification: 'VERIFIED',
      minimumRequirement: true,
      municipalitySpecific: false,
      documentId: 'doc-1',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await repo.save(req as any);

    expect(prisma.requirementRecord.upsert).toHaveBeenCalled();
  });
});
