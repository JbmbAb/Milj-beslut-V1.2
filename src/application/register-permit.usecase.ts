import { PermitCase, DecisionType } from '../domain/permit';
import { IPermitCaseRepository } from '../domain/permit-case-repository.interface';
import { IAuditRepository } from '../domain/audit-repository.interface';
import { AuditAction } from '../domain/audit';
import { randomUUID } from 'node:crypto';

export interface RegisterPermitInput {
  projectId: string;
  caseNumber: string;
  authorityName: string;
  municipality: string;
  decisionType: DecisionType;
  userId: string;
}

export class RegisterPermitUseCase {
  constructor(
    private permitRepo: IPermitCaseRepository,
    private auditRepo: IAuditRepository,
  ) {}

  async execute(input: RegisterPermitInput): Promise<PermitCase> {
    const permit: PermitCase = {
      id: randomUUID(),
      projectId: input.projectId,
      caseNumber: input.caseNumber,
      authorityName: input.authorityName,
      decisionType: input.decisionType,
      municipality: input.municipality,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const savedPermit = await this.permitRepo.save(permit);

    await this.auditRepo.save({
      id: randomUUID(),
      timestamp: new Date(),
      userId: input.userId,
      action: AuditAction.CREATE,
      entityType: 'PermitCase',
      entityId: savedPermit.id,
      details: `Permit case ${savedPermit.caseNumber} registered for project ${input.projectId}`,
    });

    return savedPermit;
  }
}
