import type { MassGISAnalysis } from '../src/types/mass';

export function isSensitiveAreaFromMassGis(analysis: MassGISAnalysis): boolean {
  const hasHighWaterConstraint = analysis.siteConstraints.some(
    (constraint) => constraint.code === 'WATER_PROXIMITY' && constraint.severity === 'HIGH',
  );
  return hasHighWaterConstraint || analysis.overallRiskScore >= 70;
}
