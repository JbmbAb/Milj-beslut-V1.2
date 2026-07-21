import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { auditInSarRiskAtPoint } from '../../server/services/sgiInSarService';

describe('sgiInSarService', () => {
  const originalVitestEnv = process.env.VITEST;

  beforeEach(() => {
    process.env.VITEST = 'true';
  });

  afterEach(() => {
    process.env.VITEST = originalVitestEnv;
  });

  it('bör returnera HIGH risk för koordinater med lat > 60.5', async () => {
    const result = await auditInSarRiskAtPoint(60.6, 15.0);
    expect(result.riskLevel).toBe('HIGH');
    expect(result.maxSubsidenceMmYear).toBeLessThanOrEqual(-5.0);
    expect(result.advisory).toContain('VARNING');
    expect(result.pointCount).toBeGreaterThan(0);
  });

  it('bör returnera MEDIUM risk för koordinater mellan 59.5 och 60.5', async () => {
    const result = await auditInSarRiskAtPoint(60.0, 15.0);
    expect(result.riskLevel).toBe('MEDIUM');
    expect(result.maxSubsidenceMmYear).toBeLessThanOrEqual(-1.5);
    expect(result.maxSubsidenceMmYear).toBeGreaterThan(-5.0);
    expect(result.advisory).toContain('OBSERVERA');
  });

  it('bör returnera LOW risk för övriga koordinater', async () => {
    const result = await auditInSarRiskAtPoint(58.0, 15.0);
    expect(result.riskLevel).toBe('LOW');
    expect(result.maxSubsidenceMmYear).toBeGreaterThan(-1.5);
    expect(result.advisory).toContain('stabila');
  });
});
