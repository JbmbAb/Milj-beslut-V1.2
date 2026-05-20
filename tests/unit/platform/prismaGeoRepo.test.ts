import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PrismaGeoRepository } from '../../../src/infrastructure/prisma-geo-repository';
import { GeoLayerType, RiskLevel } from '../../../src/domain/geo';
import * as db from '../../../db.server';

vi.mock('../../../db.server');

describe('PrismaGeoRepository', () => {
  let repo: PrismaGeoRepository;
  let mockPrisma: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockPrisma = {
      project: {
        findUnique: vi.fn(),
        update: vi.fn(),
      },
    };

    (db as any).prisma = mockPrisma;
    repo = new PrismaGeoRepository();
  });

  // ── findByProject ────────────────────────────────────────────────────────────

  it('should return empty array when project not found', async () => {
    mockPrisma.project.findUnique.mockResolvedValue(null);

    const result = await repo.findByProject('missing-id');

    expect(result).toEqual([]);
    expect(mockPrisma.project.findUnique).toHaveBeenCalledWith({
      where: { id: 'missing-id' },
      include: { planState: true },
    });
  });

  it('should return assessments with high risk when regulatory score > 70', async () => {
    const projectId = 'proj-1';
    const now = new Date();
    mockPrisma.project.findUnique.mockResolvedValue({
      id: projectId,
      regulatoryRiskScore: 85,
      createdAt: now,
      planState: { updatedAt: now },
    });

    const result = await repo.findByProject(projectId);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      projectId,
      layerType: GeoLayerType.WATER_PROTECTION,
      riskLevel: RiskLevel.HIGH,
    });
  });

  it('should return assessments with medium risk when regulatory score 30-70', async () => {
    const projectId = 'proj-2';
    const now = new Date();
    mockPrisma.project.findUnique.mockResolvedValue({
      id: projectId,
      regulatoryRiskScore: 50,
      createdAt: now,
      planState: { updatedAt: now },
    });

    const result = await repo.findByProject(projectId);

    expect(result).toHaveLength(1);
    expect(result[0].riskLevel).toBe(RiskLevel.MEDIUM);
  });

  it('should return assessments with low risk when regulatory score < 30', async () => {
    const projectId = 'proj-3';
    const now = new Date();
    mockPrisma.project.findUnique.mockResolvedValue({
      id: projectId,
      regulatoryRiskScore: 10,
      createdAt: now,
      planState: null,
    });

    const result = await repo.findByProject(projectId);

    expect(result).toHaveLength(1);
    expect(result[0].riskLevel).toBe(RiskLevel.LOW);
  });

  it('should skip assessment when regulatory score is null', async () => {
    const projectId = 'proj-4';
    const now = new Date();
    mockPrisma.project.findUnique.mockResolvedValue({
      id: projectId,
      regulatoryRiskScore: null,
      createdAt: now,
      planState: null,
    });

    const result = await repo.findByProject(projectId);

    expect(result).toEqual([]);
  });

  // ── save ─────────────────────────────────────────────────────────────────────

  it('should save assessment and update project', async () => {
    mockPrisma.project.update.mockResolvedValue({ id: 'proj-1' });

    const assessment = {
      id: 'assess-1',
      projectId: 'proj-1',
      layerType: GeoLayerType.WATER_PROTECTION,
      riskLevel: RiskLevel.HIGH,
      details: 'Test assessment',
      assessedAt: new Date(),
    };

    const result = await repo.save(assessment);

    expect(result).toEqual(assessment);
    expect(mockPrisma.project.update).toHaveBeenCalledWith({
      where: { id: 'proj-1' },
      data: { regulatoryRiskScore: expect.any(Number) },
    });
  });

  it('should map HIGH risk to score 71+', async () => {
    mockPrisma.project.update.mockResolvedValue({ id: 'proj-1' });

    const assessment = {
      id: 'assess-1',
      projectId: 'proj-1',
      layerType: GeoLayerType.WATER_PROTECTION,
      riskLevel: RiskLevel.HIGH,
      details: 'High risk',
      assessedAt: new Date(),
    };

    await repo.save(assessment);

    const updateCall = mockPrisma.project.update.mock.calls[0];
    const score = updateCall[0].data.regulatoryRiskScore;
    expect(score).toBeGreaterThan(70);
  });

  it('should map MEDIUM risk to score 31-70', async () => {
    mockPrisma.project.update.mockResolvedValue({ id: 'proj-1' });

    const assessment = {
      id: 'assess-1',
      projectId: 'proj-1',
      layerType: GeoLayerType.WATER_PROTECTION,
      riskLevel: RiskLevel.MEDIUM,
      details: 'Medium risk',
      assessedAt: new Date(),
    };

    await repo.save(assessment);

    const updateCall = mockPrisma.project.update.mock.calls[0];
    const score = updateCall[0].data.regulatoryRiskScore;
    expect(score).toBeGreaterThanOrEqual(31);
    expect(score).toBeLessThanOrEqual(70);
  });

  it('should map LOW risk to score 0-30', async () => {
    mockPrisma.project.update.mockResolvedValue({ id: 'proj-1' });

    const assessment = {
      id: 'assess-1',
      projectId: 'proj-1',
      layerType: GeoLayerType.WATER_PROTECTION,
      riskLevel: RiskLevel.LOW,
      details: 'Low risk',
      assessedAt: new Date(),
    };

    await repo.save(assessment);

    const updateCall = mockPrisma.project.update.mock.calls[0];
    const score = updateCall[0].data.regulatoryRiskScore;
    expect(score).toBeLessThanOrEqual(30);
  });

  // ── Edge Cases ───────────────────────────────────────────────────────────────

  it('should use createdAt when planState.updatedAt is null', async () => {
    const projectId = 'proj-5';
    const createdAt = new Date('2025-01-01');
    mockPrisma.project.findUnique.mockResolvedValue({
      id: projectId,
      regulatoryRiskScore: 50,
      createdAt,
      planState: { updatedAt: null },
    });

    const result = await repo.findByProject(projectId);

    expect(result[0].assessedAt).toEqual(createdAt);
  });

  it('should handle multiple assessments from same project', async () => {
    const projectId = 'proj-6';
    const now = new Date();
    mockPrisma.project.findUnique.mockResolvedValue({
      id: projectId,
      regulatoryRiskScore: 75,
      createdAt: now,
      planState: { updatedAt: now },
    });

    const result = await repo.findByProject(projectId);

    // Currently returns one assessment per project
    expect(result).toHaveLength(1);
  });

  it('should handle database errors gracefully', async () => {
    mockPrisma.project.findUnique.mockRejectedValue(new Error('DB error'));

    await expect(repo.findByProject('proj-1')).rejects.toThrow('DB error');
  });
});
