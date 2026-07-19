/**
 * complianceRuleEngine.ts (Legacy Wrapper)
 *
 * Delegating all logic to Clean Architecture Use Case in src/application/
 */

import {
  EvaluateComplianceRulesUseCase,
  type RiskLevel,
  type ComplianceRuleResult,
  type SiteAnalysis,
  type ComplianceMetrics,
  type RuleEngineResult,
  type ProtectedArea,
  type Monument,
  type GeologicalData,
} from '../../src/application/evaluate-compliance-rules.usecase';

export {
  RiskLevel,
  ComplianceRuleResult,
  SiteAnalysis,
  ComplianceMetrics,
  RuleEngineResult,
  ProtectedArea,
  Monument,
  GeologicalData,
};

const useCase = new EvaluateComplianceRulesUseCase();

export function evaluateComplianceRules(
  observations: Array<{ name?: string; status?: string }>,
  protectedAreas: ProtectedArea[],
  geological: GeologicalData,
  monuments: Monument[],
  distanceToWater: number = 200,
): SiteAnalysis {
  return useCase.evaluateComplianceRules(
    observations,
    protectedAreas,
    geological,
    monuments,
    distanceToWater,
  );
}

export const evaluateProjectCompliance = (metrics: ComplianceMetrics): RuleEngineResult => {
  return useCase.evaluateProjectCompliance(metrics);
};
