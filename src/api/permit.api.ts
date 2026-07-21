import { z } from 'zod';
import { DecisionType } from '../domain/permit';
import { IPermitCaseRepository } from '../domain/permit-case-repository.interface';
import { IAuditRepository } from '../domain/audit-repository.interface';
import { RegisterPermitUseCase } from '../application/register-permit.usecase';

export const RegisterPermitSchema = z.object({
  projectId: z.string().uuid(),
  caseNumber: z.string(),
  authorityName: z.string(),
  municipality: z.string(),
  decisionType: z.nativeEnum(DecisionType),
});

export class PermitController {
  private registerUseCase: RegisterPermitUseCase;

  constructor(permitRepo: IPermitCaseRepository, auditRepo: IAuditRepository) {
    this.registerUseCase = new RegisterPermitUseCase(permitRepo, auditRepo);
  }

  async register(data: unknown, userId: string) {
    const validated = RegisterPermitSchema.parse(data);
    return await this.registerUseCase.execute({
      projectId: validated.projectId,
      caseNumber: validated.caseNumber,
      authorityName: validated.authorityName,
      municipality: validated.municipality,
      decisionType: validated.decisionType,
      userId,
    });
  }
}
