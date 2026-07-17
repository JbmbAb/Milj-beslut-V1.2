import type { ProjectPlan, CarbonResult } from '../types';

/**
 * Predictive Scoring Engine
 *
 * Implements the logic described in the system architecture blueprint.
 * Combines regulatory data, GIS analysis simulations, and financial risk models.
 */

export function calculatePredictiveScores(plan: ProjectPlan, carbonResult?: CarbonResult | null) {
  const regulatoryCode = plan.permitCodeProfile?.activityCode || plan.permitCodeProfile?.code || '17 05 04';
  const _volume = plan.transportBookings.reduce((sum, b) => sum + b.tons, 0) || 1000;
  const location = plan.location.address.toLowerCase() || 'unknown';

  // 1. Regulatory Risk Prediction (Simulation of historical pattern matching)
  const baseRfiProb = plan.permitCodeProfile?.riskTier === 'HIGH' ? 0.45 : 0.15;
  const geoRfiProb = location.includes('skydd') || location.includes('nara') ? 0.3 : 0;
  const probabilityRfi = Math.min(0.95, baseRfiProb + geoRfiProb);
  const probabilityInjunction = probabilityRfi * 0.4; // 40% of RFI lead to injunctions in our model.

  const regScore = (probabilityRfi + probabilityInjunction) / 1.4;

  const regRisk = {
    score: Math.round(regScore * 100) / 100,
    probabilityRfi: Math.round(probabilityRfi * 100) / 100,
    probabilityInjunction: Math.round(probabilityInjunction * 100) / 100,
    confidence: 0.85,
    topRiskFactors: [
      plan.permitCodeProfile?.riskTier === 'HIGH'
        ? `Hög riskklass för kod ${regulatoryCode}`
        : `Normal riskklass för kod ${regulatoryCode}`,
      geoRfiProb > 0 ? 'Geografisk känslighet detekterad' : 'Ingen direkt geografisk konflikt funnen',
    ].filter(Boolean) as string[],
  };

  // 2. Environmental Risk Prediction (Simulated GIS overlay)
  const groundwaterImpact = plan.mapLayerSelection.enabled.includes('GROUNDWATER') ? 0.8 : 0.1;
  const biodiversityImpact = plan.mapLayerSelection.enabled.includes('NATURA2000') ? 0.9 : 0.05;
  const floodingImpact = plan.mapLayerSelection.enabled.includes('FLOOD_RISK') ? 0.6 : 0.1;

  const envScore = groundwaterImpact * 0.5 + biodiversityImpact * 0.3 + floodingImpact * 0.2;

  const envRisk = {
    score: Math.round(envScore * 100) / 100,
    groundwaterImpact,
    biodiversityImpact,
    floodingImpact,
  };

  // 3. Funding Risk (ABC Rating for Green Loans)
  const complianceScore = plan.complianceScore || 0;
  const hasCarbon = Boolean(carbonResult || plan.carbonSummary.lastResult);

  // Formula: High compliance + low predictive risk = AAA
  let fundingScore = (complianceScore / 100) * 0.6 - regScore * 0.2 - envScore * 0.2;
  if (hasCarbon) fundingScore += 0.1; // Carbon reporting bonus

  let rating: 'AAA' | 'AA' | 'A' | 'BBB' | 'BB' | 'B' | 'CCC' | 'C' = 'B';
  if (fundingScore >= 0.85) rating = 'AAA';
  else if (fundingScore >= 0.75) rating = 'AA';
  else if (fundingScore >= 0.65) rating = 'A';
  else if (fundingScore >= 0.55) rating = 'BBB';
  else if (fundingScore >= 0.45) rating = 'BB';
  else if (fundingScore >= 0.35) rating = 'B';
  else if (fundingScore >= 0.25) rating = 'CCC';
  else rating = 'C';

  const fundRisk = {
    score: Math.round(Math.max(0, fundingScore) * 100) / 100,
    rating,
    eligibleForGreenLoan: fundingScore >= 0.65 && hasCarbon,
  };

  return {
    regulatoryRisk: regRisk,
    environmentalRisk: envRisk,
    fundingRisk: fundRisk,
  };
}
