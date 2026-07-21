import { prisma } from '../../db.server';
import { IGeoRepository } from '../domain/geo-repository.interface';
import { GeoAssessment, RiskLevel, GeoLayerType } from '../domain/geo';

export class PrismaGeoRepository implements IGeoRepository {
  async findByProject(projectId: string): Promise<GeoAssessment[]> {
    // Current schema uses ProjectPlanState or specific risk fields on Project
    // This is a mapping to the new domain model
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: { planState: true },
    });

    if (!project) return [];

    // Map existing fields to domain assessments
    const assessments: GeoAssessment[] = [];

    if (project.regulatoryRiskScore !== null) {
      assessments.push({
        id: `reg-${project.id}`,
        projectId: project.id,
        layerType: GeoLayerType.WATER_PROTECTION, // Placeholder mapping
        riskLevel: this.mapScoreToRisk(project.regulatoryRiskScore),
        details: 'Regulatory risk from project state',
        assessedAt: project.planState?.updatedAt ?? project.createdAt,
      });
    }

    return assessments;
  }

  async save(assessment: GeoAssessment): Promise<GeoAssessment> {
    // For now, we update the project state as the schema lacks a GeoAssessment table
    await prisma.project.update({
      where: { id: assessment.projectId },
      data: {
        regulatoryRiskScore: this.mapRiskToScore(assessment.riskLevel),
      },
    });
    return assessment;
  }

  private mapScoreToRisk(score: number): RiskLevel {
    if (score > 70) return RiskLevel.HIGH;
    if (score > 30) return RiskLevel.MEDIUM;
    return RiskLevel.LOW;
  }

  private mapRiskToScore(risk: RiskLevel): number {
    switch (risk) {
      case RiskLevel.HIGH:
        return 80;
      case RiskLevel.MEDIUM:
        return 40;
      case RiskLevel.LOW:
        return 10;
      default:
        return 0;
    }
  }
}
