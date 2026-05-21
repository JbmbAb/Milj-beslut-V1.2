export interface ProtectedArea {
  name: string;
  type: string;
  id: string;
  area_ha?: number;
}

export interface GeologicalData {
  soilType?: string;
  groundwaterVulnerability?: string;
  groundwaterFlow?: string;
  riskDescription?: string;
  groundLayerScale?: string;
  landslideFeatureHits?: Array<{
    featureCode?: number | null;
    featureLabel: string;
    distanceMeters: number;
  }>;
  landslideRiskLevel?: 'NONE' | 'ADVISORY' | 'HIGH';
  manualReviewRequired?: boolean;
  coverageMode?: 'sample' | 'complete';
}

export interface Monument {
  id: string;
  name: string;
  type: string;
  distance: number;
}

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'BLOCK';

export interface ComplianceRuleResult {
  ruleId: string;
  chapter: string;
  title: string;
  risk: RiskLevel;
  description: string;
  recommendation: string;
}

export interface SiteAnalysis {
  overallRisk: RiskLevel;
  permitProbability: number;
  restrictions: string[];
  rules: ComplianceRuleResult[];
  summary: string;
}
