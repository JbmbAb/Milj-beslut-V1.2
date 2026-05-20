import { prisma } from '../../db.server';
import { Requirement, RequirementLevel, RequirementStatus } from '../domain/requirement';
import { IRequirementRepository } from '../domain/requirement-repository.interface';

export class PrismaRequirementRepository implements IRequirementRepository {
  async findById(id: string): Promise<Requirement | null> {
    const req = await prisma.requirementRecord.findUnique({ where: { id } });
    return req ? this.mapToDomain(req) : null;
  }

  async findByProject(projectId: string): Promise<Requirement[]> {
    const reqs = await prisma.requirementRecord.findMany({ where: { projectId } });
    return reqs.map((r) => this.mapToDomain(r));
  }

  async save(requirement: Requirement): Promise<Requirement> {
    const data = {
      projectId: requirement.sourceDocumentId || '', // Simplified mapping
      requirementCode: requirement.code,
      category: requirement.category,
      subcategory: requirement.subcategory || '',
      requirementTextQuote: requirement.text,
      interpretedRequirement: requirement.interpretedText || '',
      level: requirement.level,
      statusInNotification: requirement.status,
      minimumRequirement: requirement.isMinimumRequirement,
      municipalitySpecific: requirement.municipalitySpecific,
    };

    const upserted = await prisma.requirementRecord.upsert({
      where: { id: requirement.id },
      update: data,
      create: {
        ...data,
        id: requirement.id,
        caseId: 'system-case',
        documentId: requirement.sourceDocumentId || 'system-doc',
        sourceType: 'MANUAL',
      },
    });

    return this.mapToDomain(upserted);
  }

  async delete(id: string): Promise<void> {
    await prisma.requirementRecord.delete({ where: { id } });
  }

  private mapToDomain(prismaReq: any): Requirement {
    return {
      id: prismaReq.id,
      code: prismaReq.requirementCode,
      category: prismaReq.category,
      subcategory: prismaReq.subcategory,
      text: prismaReq.requirementTextQuote,
      interpretedText: prismaReq.interpretedRequirement,
      level: prismaReq.level as RequirementLevel,
      status: prismaReq.statusInNotification as RequirementStatus,
      sourceDocumentId: prismaReq.documentId,
      isMinimumRequirement: prismaReq.minimumRequirement,
      municipalitySpecific: prismaReq.municipalitySpecific,
      createdAt: prismaReq.createdAt,
      updatedAt: prismaReq.updatedAt,
    };
  }
}
