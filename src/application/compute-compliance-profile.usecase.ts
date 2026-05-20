import {
  ComplianceProfile,
  ComplianceStatus,
  ComplianceCategory,
  RatingLabel,
  IndicatorScore,
  TaxonomyIndicator,
} from '../domain/compliance';
import { IComplianceRepository } from '../domain/compliance-repository.interface';
import { IProjectRepository } from '../domain/project-repository.interface';
import { IRequirementRepository } from '../domain/requirement-repository.interface';
import { IAuditRepository } from '../domain/audit-repository.interface';

export interface ComputeComplianceProfileInput {
  projectId: string;
}

export class ComputeComplianceProfileUseCase {
  constructor(
    private complianceRepo: IComplianceRepository,
    private projectRepo: IProjectRepository,
    private requirementRepo: IRequirementRepository,
    private auditRepo: IAuditRepository,
  ) {}

  async execute(input: ComputeComplianceProfileInput): Promise<ComplianceProfile> {
    const project = await this.projectRepo.findById(input.projectId);
    if (!project) throw new Error('Project not found');

    const indicators = await this.complianceRepo.getAllIndicators();
    const requirements = await this.requirementRepo.findByProject(input.projectId);
    const auditTrail = await this.auditRepo.findByEntity('Project', input.projectId);

    const scores: IndicatorScore[] = indicators.map((ind) =>
      this.scoreIndicator(ind, {
        project,
        requirements,
        auditTrail,
      }),
    );

    const maxTotal = indicators.reduce((sum, ind) => sum + ind.maxScore, 0);
    const totalScore = scores.reduce((sum, s) => sum + s.score, 0);
    const overallScore = Math.round((totalScore / maxTotal) * 100);

    const categoryScores = this.computeCategoryScores(indicators, scores);
    const criticalGaps = scores
      .filter((s) => s.status === ComplianceStatus.FAIL)
      .map((s) => `${indicators.find((i) => i.id === s.indicatorId)?.name}: ${s.notes}`);

    const ratingLabel = this.mapToRatingLabel(overallScore);

    const profile: ComplianceProfile = {
      projectId: input.projectId,
      computedAt: new Date(),
      overallScore,
      ratingLabel,
      categoryScores: categoryScores as any,
      indicators: scores,
      summary: `Compliance profile for ${project.name}: ${overallScore}/100 (${ratingLabel}).`,
      criticalGaps,
    };

    return await this.complianceRepo.saveProfile(profile);
  }

  private scoreIndicator(indicator: TaxonomyIndicator, data: any): IndicatorScore {
    // Re-implementation of the scoring logic from bankComplianceProfileService.ts
    // but using the new domain models
    let score = 0;
    let status = ComplianceStatus.FAIL;
    let notes = '';

    // Logic for each indicator ID... (Simplified for now)
    if (indicator.id === 'ENV_PERMIT') {
      const hasPermit = data.project.status !== 'DRAFT';
      score = hasPermit ? indicator.maxScore : 0;
      status = hasPermit ? ComplianceStatus.PASS : ComplianceStatus.FAIL;
      notes = hasPermit ? 'Permit registered' : 'No permit found';
    } else if (indicator.id === 'GOV_REQUIREMENTS') {
      const total = data.requirements.length || 1;
      const fulfilled = data.requirements.filter((r: any) => r.status === 'VERIFIED').length;
      const ratio = fulfilled / total;
      score = Math.round(indicator.maxScore * ratio);
      status =
        ratio >= 0.8 ? ComplianceStatus.PASS : ratio > 0.3 ? ComplianceStatus.PARTIAL : ComplianceStatus.FAIL;
      notes = `${fulfilled}/${total} requirements verified.`;
    } else {
      score = 0;
      status = ComplianceStatus.FAIL;
      notes = 'No verified evaluator configured for this indicator.';
    }

    return {
      indicatorId: indicator.id,
      status,
      score,
      maxScore: indicator.maxScore,
      notes,
    };
  }

  private computeCategoryScores(indicators: TaxonomyIndicator[], scores: IndicatorScore[]) {
    const categories = [
      ComplianceCategory.ENVIRONMENTAL,
      ComplianceCategory.SOCIAL,
      ComplianceCategory.GOVERNANCE,
      ComplianceCategory.LEGAL,
    ];

    const result: any = {};
    categories.forEach((cat) => {
      const catInds = indicators.filter((i) => i.category === cat);
      const catScores = scores.filter((s) => catInds.some((i) => i.id === s.indicatorId));

      const score = catScores.reduce((sum, s) => sum + s.score, 0);
      const maxScore = catInds.reduce((sum, i) => sum + i.maxScore, 0);

      result[cat] = {
        score,
        maxScore,
        percentage: maxScore > 0 ? Math.round((score / maxScore) * 100) : 0,
      };
    });
    return result;
  }

  private mapToRatingLabel(score: number): RatingLabel {
    if (score >= 90) return RatingLabel.EXCELLENT;
    if (score >= 75) return RatingLabel.GOOD;
    if (score >= 55) return RatingLabel.ACCEPTABLE;
    if (score >= 35) return RatingLabel.WEAK;
    return RatingLabel.FAILING;
  }
}
