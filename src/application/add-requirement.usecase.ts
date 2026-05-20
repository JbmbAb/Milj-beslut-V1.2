import { Requirement, RequirementLevel, RequirementStatus } from '../domain/requirement';
import { IRequirementRepository } from '../domain/requirement-repository.interface';
import { IAuditRepository } from '../domain/audit-repository.interface';
import { AuditAction } from '../domain/audit';
import { randomUUID } from 'node:crypto';

export interface AddRequirementInput {
  code: string;
  category: string;
  text: string;
  level: RequirementLevel;
  sourceDocumentId: string;
  userId: string;
}

export class AddRequirementUseCase {
  constructor(
    private requirementRepo: IRequirementRepository,
    private auditRepo: IAuditRepository,
  ) {}

  async execute(input: AddRequirementInput): Promise<Requirement> {
    const requirement: Requirement = {
      id: randomUUID(),
      code: input.code,
      category: input.category,
      text: input.text,
      level: input.level,
      status: RequirementStatus.PENDING,
      sourceDocumentId: input.sourceDocumentId,
      isMinimumRequirement: false,
      municipalitySpecific: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const savedReq = await this.requirementRepo.save(requirement);

    await this.auditRepo.save({
      id: randomUUID(),
      timestamp: new Date(),
      userId: input.userId,
      action: AuditAction.CREATE,
      entityType: 'Requirement',
      entityId: savedReq.id,
      details: `Requirement ${savedReq.code} extracted from document ${input.sourceDocumentId}`,
    });

    return savedReq;
  }
}
