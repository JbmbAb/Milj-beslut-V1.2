import { prisma } from '../../db.server';
import { PermitCase, DecisionType } from '../domain/permit';
import { IPermitCaseRepository } from '../domain/permit-case-repository.interface';

export class PrismaPermitCaseRepository implements IPermitCaseRepository {
  async findById(id: string): Promise<PermitCase | null> {
    const p = await prisma.requirementCase.findUnique({ where: { id } });
    return p ? this.mapToDomain(p) : null;
  }

  async findByProject(projectId: string): Promise<PermitCase[]> {
    const permits = await prisma.requirementCase.findMany({ where: { projectId } });
    return permits.map((p) => this.mapToDomain(p));
  }

  async save(permit: PermitCase): Promise<PermitCase> {
    const data = {
      projectId: permit.projectId,
      caseKey: permit.caseNumber || permit.id,
      authorityName: permit.authorityName,
      municipality: permit.municipality,
      documentId: 'temp-doc-id', // Mapping name to requirementCase
      organisationId: 'temp-org-id',
      sourceFile: 'MANUAL',
    };

    const upserted = await prisma.requirementCase.upsert({
      where: { id: permit.id },
      update: data,
      create: { ...data, id: permit.id },
    });

    return this.mapToDomain(upserted);
  }

  private mapToDomain(p: any): PermitCase {
    return {
      id: p.id,
      projectId: p.projectId,
      caseNumber: p.caseKey,
      authorityName: p.authorityName || 'Okänd myndighet',
      decisionType: DecisionType.UNKNOWN, // Default to UNKNOWN for unmapped status
      municipality: p.municipality || '',
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    };
  }
}
