import { z } from 'zod';
import { RequirementLevel } from '../domain/requirement';
import { IRequirementRepository } from '../domain/requirement-repository.interface';
import { IAuditRepository } from '../domain/audit-repository.interface';
import { AddRequirementUseCase } from '../application/add-requirement.usecase';

export const AddRequirementSchema = z.object({
  code: z.string(),
  category: z.string(),
  text: z.string().min(10),
  level: z.nativeEnum(RequirementLevel),
  sourceDocumentId: z.string().uuid(),
});

export class RequirementController {
  private addUseCase: AddRequirementUseCase;

  constructor(requirementRepo: IRequirementRepository, auditRepo: IAuditRepository) {
    this.addUseCase = new AddRequirementUseCase(requirementRepo, auditRepo);
  }

  async add(data: unknown, userId: string) {
    const validated = AddRequirementSchema.parse(data);
    return await this.addUseCase.execute({
      code: validated.code,
      category: validated.category,
      text: validated.text,
      level: validated.level,
      sourceDocumentId: validated.sourceDocumentId,
      userId,
    });
  }
}
