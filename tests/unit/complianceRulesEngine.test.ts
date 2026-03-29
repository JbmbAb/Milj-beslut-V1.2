import { describe, expect, it } from 'vitest';
import {
  evaluateProjectCompliance,
  type ComplianceMetrics,
  type RuleEngineResult,
} from '../../services/complianceRulesEngine';

// ─── helpers ─────────────────────────────────────────────────────────────────

function baseMetrics(overrides: Partial<ComplianceMetrics> = {}): ComplianceMetrics {
  return {
    volumeTons: 0,
    hazardousClassification: false,
    groundwaterProximity: false,
    missingDocumentation: false,
    labExceedancesCount: 0,
    ...overrides,
  };
}

// ─── tests ───────────────────────────────────────────────────────────────────

describe('evaluateProjectCompliance – permit/notification thresholds', () => {
  it('returns NONE for tiny clean project', () => {
    const result: RuleEngineResult = evaluateProjectCompliance(baseMetrics({ volumeTons: 5 }));
    expect(result.requiresPermitOrNotification).toBe('NONE');
    expect(result.riskScore).toBe('LOW');
    expect(result.requirements).toHaveLength(0);
    expect(result.riskFactors).toHaveLength(0);
  });

  it('requires NOTIFICATION for volume > 10 tons', () => {
    const result = evaluateProjectCompliance(baseMetrics({ volumeTons: 50 }));
    expect(result.requiresPermitOrNotification).toBe('NOTIFICATION');
    expect(result.requirements[0]).toContain('Anmälan');
    expect(result.requirements[0]).toContain('50');
  });

  it('requires NOTIFICATION for volume exactly 11 tons', () => {
    const result = evaluateProjectCompliance(baseMetrics({ volumeTons: 11 }));
    expect(result.requiresPermitOrNotification).toBe('NOTIFICATION');
  });

  it('requires PERMIT for volume > 10 000 tons', () => {
    const result = evaluateProjectCompliance(baseMetrics({ volumeTons: 15000 }));
    expect(result.requiresPermitOrNotification).toBe('PERMIT');
    expect(result.requirements[0]).toContain('Tillstånd');
  });

  it('requires PERMIT when hazardousClassification even below 10 000 ton threshold', () => {
    const result = evaluateProjectCompliance(baseMetrics({ volumeTons: 100, hazardousClassification: true }));
    expect(result.requiresPermitOrNotification).toBe('PERMIT');
  });
});

describe('evaluateProjectCompliance – risk scoring', () => {
  it('LOW risk when all flags clean', () => {
    const result = evaluateProjectCompliance(baseMetrics({ volumeTons: 5 }));
    expect(result.riskScore).toBe('LOW');
  });

  it('MEDIUM risk for moderate volume (>100 tons, no other flags)', () => {
    const result = evaluateProjectCompliance(baseMetrics({ volumeTons: 200 }));
    // volumeTons>100 adds 1 raw point → < 3 → LOW unless combined
    expect(result.riskScore).toBe('LOW');
  });

  it('MEDIUM risk when groundwater + missingDocs', () => {
    const result = evaluateProjectCompliance(
      baseMetrics({
        groundwaterProximity: true,
        missingDocumentation: true,
      }),
    );
    // 3 (gw) + 2 (docs) = 5 → MEDIUM
    expect(result.riskScore).toBe('MEDIUM');
    expect(result.riskFactors).toHaveLength(2);
  });

  it('HIGH risk for hazardous + groundwater + lab exceedances', () => {
    const result = evaluateProjectCompliance(
      baseMetrics({
        hazardousClassification: true,
        groundwaterProximity: true,
        labExceedancesCount: 2,
      }),
    );
    // 5 (haz) + 3 (gw) + 4 (lab) = 12 → HIGH
    expect(result.riskScore).toBe('HIGH');
    expect(result.riskFactors.length).toBeGreaterThanOrEqual(3);
  });

  it('HIGH risk at raw score exactly 7 (volume 50k + groundwater)', () => {
    const result = evaluateProjectCompliance(
      baseMetrics({
        volumeTons: 51000, // > 50 000 adds 3
        groundwaterProximity: true, // adds 3
        missingDocumentation: true, // adds 2 → total 8 → HIGH
      }),
    );
    expect(result.riskScore).toBe('HIGH');
  });

  it('MEDIUM risk at raw score between 3 and 6', () => {
    const result = evaluateProjectCompliance(
      baseMetrics({
        volumeTons: 1500, // > 1 000 adds 2
        missingDocumentation: true, // adds 2 → total 4 → MEDIUM
      }),
    );
    expect(result.riskScore).toBe('MEDIUM');
  });

  it('lab exceedances appear in riskFactors with count', () => {
    const result = evaluateProjectCompliance(baseMetrics({ labExceedancesCount: 3 }));
    expect(result.riskFactors[0]).toContain('3');
  });
});

describe('evaluateProjectCompliance – result shape', () => {
  it('always returns the four expected keys', () => {
    const result = evaluateProjectCompliance(baseMetrics());
    expect(result).toHaveProperty('riskScore');
    expect(result).toHaveProperty('riskFactors');
    expect(result).toHaveProperty('requiresPermitOrNotification');
    expect(result).toHaveProperty('requirements');
  });

  it('hazardous flag adds factor text', () => {
    const result = evaluateProjectCompliance(baseMetrics({ hazardousClassification: true }));
    expect(result.riskFactors.some((f) => f.includes('Farligt avfall'))).toBe(true);
  });

  it('groundwater flag adds factor text', () => {
    const result = evaluateProjectCompliance(baseMetrics({ groundwaterProximity: true }));
    expect(result.riskFactors.some((f) => f.includes('vattenskyddsområde'))).toBe(true);
  });

  it('missing docs flag adds factor text', () => {
    const result = evaluateProjectCompliance(baseMetrics({ missingDocumentation: true }));
    expect(result.riskFactors.some((f) => f.includes('spårbarhetsdokumentation'))).toBe(true);
  });
});
