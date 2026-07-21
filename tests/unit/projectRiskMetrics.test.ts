import { describe, expect, it } from 'vitest';
import {
  buildProjectRiskMetrics,
  compliancePercentFromMetrics,
} from '../../server/services/projectRiskMetrics';

describe('projectRiskMetrics', () => {
  it('builds compliance metric from project scores', () => {
    const metrics = buildProjectRiskMetrics({
      complianceScore: 82,
      environmentalScore: 60,
      regulatoryRiskScore: 40,
    });

    expect(metrics.find((m) => m.name === 'Compliance')?.score).toBe(82);
  });

  it('derives compliance percent from metrics', () => {
    const metrics = buildProjectRiskMetrics({
      complianceScore: 88,
      environmentalScore: 60,
      regulatoryRiskScore: 40,
    });

    expect(compliancePercentFromMetrics(metrics)).toBe(88);
  });

  it('returns null when no metrics exist', () => {
    expect(compliancePercentFromMetrics([])).toBeNull();
  });
});
