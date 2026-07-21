/**
 * COMPLIANCE DOMAIN
 * Hanterar regelefterlevnad, taxonomi och poängsättning för banker/finans.
 */

export enum ComplianceStatus {
  PASS = 'PASS',
  PARTIAL = 'PARTIAL',
  FAIL = 'FAIL',
  NOT_APPLICABLE = 'NOT_APPLICABLE',
}

export enum ComplianceCategory {
  ENVIRONMENTAL = 'ENVIRONMENTAL',
  SOCIAL = 'SOCIAL',
  GOVERNANCE = 'GOVERNANCE',
  LEGAL = 'LEGAL',
}

export enum RatingLabel {
  EXCELLENT = 'EXCELLENT',
  GOOD = 'GOOD',
  ACCEPTABLE = 'ACCEPTABLE',
  WEAK = 'WEAK',
  FAILING = 'FAILING',
}

export interface TaxonomyIndicator {
  id: string;
  category: ComplianceCategory;
  name: string;
  description: string;
  maxScore: number;
  euTaxonomyRef?: string;
}

export interface IndicatorScore {
  indicatorId: string;
  status: ComplianceStatus;
  score: number;
  maxScore: number;
  notes: string;
}

export interface ComplianceProfile {
  projectId: string;
  computedAt: Date;
  overallScore: number; // 0-100
  ratingLabel: RatingLabel;
  categoryScores: Record<
    ComplianceCategory,
    {
      score: number;
      maxScore: number;
      percentage: number;
    }
  >;
  indicators: IndicatorScore[];
  summary: string;
  criticalGaps: string[];
}
