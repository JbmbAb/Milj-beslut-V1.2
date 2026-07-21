import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PrismaPermitCaseRepository } from '../../../src/infrastructure/prisma-permit-case-repository';
import { prisma } from '../../../db.server';
import { DecisionType } from '../../../src/domain/permit';

vi.mock('../../../db.server', () => ({
  prisma: {
    requirementCase: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      upsert: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

describe('PrismaPermitCaseRepository', () => {
  let repo: PrismaPermitCaseRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = new PrismaPermitCaseRepository();
  });

  it('should save a permit case', async () => {
    const permit = {
      id: 'p1',
      projectId: 'proj1',
      authorityName: 'Länsstyrelsen',
      decisionType: DecisionType.BIFALL,
      municipality: 'Stockholm',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    (prisma.requirementCase.upsert as any).mockResolvedValue(permit);

    await repo.save(permit as any);

    expect(prisma.requirementCase.upsert).toHaveBeenCalled();
  });
});
