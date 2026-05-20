import { prisma } from '../../db.server';
import { IComplianceRepository } from '../domain/compliance-repository.interface';
import { ComplianceProfile, TaxonomyIndicator, ComplianceCategory, RatingLabel } from '../domain/compliance';

export class PrismaComplianceRepository implements IComplianceRepository {
  async saveProfile(profile: ComplianceProfile): Promise<ComplianceProfile> {
    // We store the main scores on the Project model in the current schema
    await prisma.project.update({
      where: { id: profile.projectId },
      data: {
        complianceScore: profile.overallScore,
        fundingRating: profile.ratingLabel,
      },
    });

    // Detailed indicators could be stored in a separate table,
    // but for now we rely on the computed profile being returned.
    // In V2 we might want a ComplianceProfile table.
    return profile;
  }

  async findLatestProfile(projectId: string): Promise<ComplianceProfile | null> {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
    });

    if (!project || project.complianceScore === null) return null;

    // Reconstruct a basic profile from project fields
    // This is a limitation of the current schema, but follows the "live data" principle
    return {
      projectId: project.id,
      computedAt: project.createdAt, // Placeholder
      overallScore: project.complianceScore,
      ratingLabel: (project.fundingRating as RatingLabel) || RatingLabel.WEAK,
      categoryScores: {} as any,
      indicators: [],
      summary: `Restored from project state.`,
      criticalGaps: [],
    };
  }

  async getAllIndicators(): Promise<TaxonomyIndicator[]> {
    // These are currently static in the domain logic but could be moved to DB
    return [
      {
        id: 'ENV_PERMIT',
        category: ComplianceCategory.ENVIRONMENTAL,
        name: 'Miljötillstånd',
        description: 'Godkänt tillstånd eller anmälan enligt MB/MPF finns',
        maxScore: 20,
        euTaxonomyRef: 'Art. 9 EU 2020/852',
      },
      {
        id: 'GOV_REQUIREMENTS',
        category: ComplianceCategory.GOVERNANCE,
        name: 'Kravuppfyllelse',
        description: 'Andel uppfyllda krav av totalt identifierade krav',
        maxScore: 15,
      },
    ];
  }
}
