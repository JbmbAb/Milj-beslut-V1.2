import { IAIService } from '../domain/ai.interface';
import { IRequirementRepository } from '../domain/requirement-repository.interface';
import { IAuditRepository } from '../domain/audit-repository.interface';
import { Requirement, RequirementLevel, RequirementStatus } from '../domain/requirement';
import { AuditAction } from '../domain/audit';
import { randomUUID } from 'node:crypto';

export interface AnalyzeDocumentAIInput {
  documentId: string;
  documentText: string;
  userId: string;
}

export class AnalyzeDocumentAIUseCase {
  constructor(
    private aiService: IAIService,
    private requirementRepo: IRequirementRepository,
    private auditRepo: IAuditRepository,
  ) {}

  async execute(input: AnalyzeDocumentAIInput): Promise<Requirement[]> {
    // 1. Använd AI för att extrahera krav
    const extracted = await this.aiService.extractRequirements(input.documentText);

    const savedRequirements: Requirement[] = [];

    // 2. Spara varje extraherat krav i databasen
    for (const ext of extracted) {
      const req: Requirement = {
        id: randomUUID(),
        code: ext.code,
        category: 'AI_EXTRACTED',
        text: ext.text,
        level: ext.level as RequirementLevel,
        status: RequirementStatus.PENDING, // AI-krav måste granskas manuellt (Human-in-the-loop)
        sourceDocumentId: input.documentId,
        isMinimumRequirement: false,
        municipalitySpecific: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const saved = await this.requirementRepo.save(req);
      savedRequirements.push(saved);

      // 3. Logga händelsen
      await this.auditRepo.save({
        id: randomUUID(),
        timestamp: new Date(),
        userId: input.userId,
        action: AuditAction.CREATE,
        entityType: 'Requirement',
        entityId: saved.id,
        details: `AI extracted requirement from document ${input.documentId}`,
      });
    }

    return savedRequirements;
  }
}
