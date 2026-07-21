import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PrismaComplianceRepository } from '../../../src/infrastructure/prisma-compliance-repository';
import { prisma } from '../../../db.server';
import { RatingLabel } from '../../../src/domain/compliance';

vi.mock('../../../db.server', () => ({
  prisma: {
    project: {
      update: vi.fn(),
      findUnique: vi.fn(),
    },
  },
}));

describe('PrismaComplianceRepository', () => {
  let repo: PrismaComplianceRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = new PrismaComplianceRepository();
  });

  it('should save compliance profile to project', async () => {
    const profile = {
      projectId: 'p1',
      overallScore: 85,
      ratingLabel: RatingLabel.GOOD,
      computedAt: new Date(),
      categoryScores: {} as any,
      indicators: [],
      summary: '',
      criticalGaps: [],
    };

    await repo.saveProfile(profile);

    expect(prisma.project.update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: {
        complianceScore: 85,
        fundingRating: RatingLabel.GOOD,
      },
    });
  });

  it('should find latest profile', async () => {
    (prisma.project.findUnique as any).mockResolvedValue({
      id: 'p1',
      complianceScore: 70,
      fundingRating: 'ACCEPTABLE',
      createdAt: new Date(),
    });

    const result = await repo.findLatestProfile('p1');
    expect(result?.overallScore).toBe(70);
  });
});
