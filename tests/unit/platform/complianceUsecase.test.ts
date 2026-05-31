import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ComputeComplianceProfileUseCase } from '../../../src/application/compute-compliance-profile.usecase';
import { ComplianceCategory } from '../../../src/domain/compliance';
import { ProjectStatus, ProjectType } from '../../../src/domain/project';

describe('ComputeComplianceProfileUseCase', () => {
  const mockComplianceRepo = {
    saveProfile: vi.fn((p) => Promise.resolve(p)),
    findLatestProfile: vi.fn(),
    getAllIndicators: vi.fn().mockResolvedValue([
      { id: 'ENV_PERMIT', category: ComplianceCategory.ENVIRONMENTAL, maxScore: 20, name: 'Permit' },
      { id: 'GOV_REQUIREMENTS', category: ComplianceCategory.GOVERNANCE, maxScore: 15, name: 'Reqs' },
    ]),
  };

  const mockProjectRepo = {
    findById: vi.fn().mockResolvedValue({
      id: 'p1',
      name: 'Test Project',
      status: ProjectStatus.ACTIVE,
      type: ProjectType.ENV_PERMIT,
    }),
    findAllByOrganisation: vi.fn(),
    save: vi.fn(),
    delete: vi.fn(),
  };

  const mockRequirementRepo = {
    findByProject: vi.fn().mockResolvedValue([
      { id: 'r1', status: 'VERIFIED' },
      { id: 'r2', status: 'PENDING' },
    ]),
    findById: vi.fn(),
    save: vi.fn(),
    delete: vi.fn(),
  };

  const mockAuditRepo = {
    findByEntity: vi.fn().mockResolvedValue([]),
    save: vi.fn(),
    findByUser: vi.fn(),
    findLatest: vi.fn(),
  };

  let useCase: ComputeComplianceProfileUseCase;

  beforeEach(() => {
    vi.clearAllMocks();
    useCase = new ComputeComplianceProfileUseCase(
      mockComplianceRepo as any,
      mockProjectRepo as any,
      mockRequirementRepo as any,
      mockAuditRepo as any,
    );
  });

  it('should compute a profile correctly for an active project', async () => {
    const result = await useCase.execute({ projectId: 'p1' });

    expect(result.projectId).toBe('p1');
    expect(result.overallScore).toBeGreaterThan(0);
    expect(mockComplianceRepo.saveProfile).toHaveBeenCalled();
    expect(result.categoryScores[ComplianceCategory.ENVIRONMENTAL]).toBeDefined();
  });

  it('should throw error if project not found', async () => {
    mockProjectRepo.findById.mockResolvedValueOnce(null);
    await expect(useCase.execute({ projectId: 'missing' })).rejects.toThrow('Project not found');
  });
});
