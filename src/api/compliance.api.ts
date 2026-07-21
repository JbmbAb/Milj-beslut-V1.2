import { IComplianceRepository } from '../domain/compliance-repository.interface';
import { IProjectRepository } from '../domain/project-repository.interface';
import { IRequirementRepository } from '../domain/requirement-repository.interface';
import { IAuditRepository } from '../domain/audit-repository.interface';
import { ComputeComplianceProfileUseCase } from '../application/compute-compliance-profile.usecase';

export class ComplianceController {
  private computeUseCase: ComputeComplianceProfileUseCase;

  constructor(
    private complianceRepo: IComplianceRepository,
    private projectRepo: IProjectRepository,
    private requirementRepo: IRequirementRepository,
    private auditRepo: IAuditRepository,
  ) {
    this.computeUseCase = new ComputeComplianceProfileUseCase(
      complianceRepo,
      projectRepo,
      requirementRepo,
      auditRepo,
    );
  }

  async getProfile(projectId: string) {
    // Check if we have a fresh one, or re-compute
    let profile = await this.complianceRepo.findLatestProfile(projectId);
    if (!profile) {
      profile = await this.computeUseCase.execute({ projectId });
    }
    return profile;
  }

  async recomputeProfile(projectId: string) {
    return await this.computeUseCase.execute({ projectId });
  }
}
