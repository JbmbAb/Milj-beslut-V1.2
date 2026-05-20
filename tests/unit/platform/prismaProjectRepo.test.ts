import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PrismaProjectRepository } from '../../../src/infrastructure/prisma-project-repository';
import { prisma } from '../../../db.server';
import { ProjectStatus, ProjectType } from '../../../src/domain/project';

vi.mock('../../../db.server', () => ({
  prisma: {
    project: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      upsert: vi.fn(),
      delete: vi.fn(),
    },
    projectPlanState: {
      upsert: vi.fn(),
    },
  },
}));

describe('PrismaProjectRepository', () => {
  let repo: PrismaProjectRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = new PrismaProjectRepository();
  });

  it('should find a project by id and map it correctly', async () => {
    const mockDbProject = {
      id: 'p1',
      propertyDesignation: 'Designation 1',
      status: 'ACTIVE',
      createdAt: new Date(),
      organisationId: 'o1',
      complianceScore: 85,
      environmentalScore: 90,
      fundingRating: 'GOOD',
      regulatoryRiskScore: 10,
    };

    (prisma.project.findUnique as any).mockResolvedValue(mockDbProject);

    const project = await repo.findById('p1');

    expect(project).toBeDefined();
    expect(project?.id).toBe('p1');
    expect(project?.status).toBe(ProjectStatus.ACTIVE);
    expect(prisma.project.findUnique).toHaveBeenCalledWith({
      where: { id: 'p1' },
      include: expect.anything(),
    });
  });

  it('should return null if project not found', async () => {
    (prisma.project.findUnique as any).mockResolvedValue(null);
    const project = await repo.findById('non-existent');
    expect(project).toBeNull();
  });

  it('should save/upsert a project', async () => {
    const project = {
      id: 'p1',
      name: 'Test',
      status: ProjectStatus.ACTIVE,
      type: ProjectType.ENV_PERMIT,
      location: { lat: 0, lng: 0, address: 'A', propertyId: 'Prop1', municipality: 'M' },
      organisationId: 'o1',
      createdBy: 'u1',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    (prisma.project.upsert as any).mockResolvedValue({
      ...project,
      propertyDesignation: project.location.propertyId,
    });

    await repo.save(project as any);

    expect(prisma.project.upsert).toHaveBeenCalled();
  });
});
