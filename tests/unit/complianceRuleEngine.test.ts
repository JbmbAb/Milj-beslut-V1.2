import { describe, expect, it } from 'vitest';
import { evaluateComplianceRules, type SiteAnalysis } from '../../server/services/complianceRuleEngine';

// ─── Test data builders ───────────────────────────────────────────────────────

function emptyGeo() {
  return {
    groundwaterVulnerability: '',
    landslideFeatureHits: [] as Array<{ featureLabel: string; distanceMeters: number }>,
    landslideRiskLevel: undefined as 'NONE' | 'ADVISORY' | 'HIGH' | undefined,
    coverageMode: 'full' as 'complete',
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('complianceRuleEngine – evaluateComplianceRules', () => {
  it('returns LOW risk and high permit probability with no restrictions', () => {
    const result: SiteAnalysis = evaluateComplianceRules([], [], emptyGeo(), []);

    expect(result.overallRisk).toBe('LOW');
    expect(result.permitProbability).toBeCloseTo(0.95);
    expect(result.restrictions).toHaveLength(0);
    expect(result.rules).toHaveLength(0);
  });

  it('detects Naturreservat as BLOCK risk', () => {
    const result = evaluateComplianceRules(
      [],
      [{ id: 'area-1', type: 'naturreservat', name: 'Tyresta' }],
      emptyGeo(),
      [],
    );

    expect(result.overallRisk).toBe('BLOCK');
    expect(result.restrictions).toContain('Naturreservat');
    expect(result.permitProbability).toBeLessThanOrEqual(0.05);

    const rule = result.rules.find((r) => r.ruleId === 'MB_7_KAP_RESERVAT');
    expect(rule).toBeDefined();
    expect(rule?.chapter).toBe('7 kap MB');
  });

  it('detects Natura 2000 as HIGH risk', () => {
    const result = evaluateComplianceRules(
      [],
      [{ id: 'area-2', type: 'Natura 2000', name: 'Natura test' }],
      emptyGeo(),
      [],
    );

    expect(result.overallRisk).toBe('HIGH');
    expect(result.restrictions).toContain('Natura 2000');
    expect(result.permitProbability).toBeLessThanOrEqual(0.25);

    const rule = result.rules.find((r) => r.ruleId === 'MB_7_KAP_N2K');
    expect(rule?.risk).toBe('HIGH');
  });

  it('detects Strandskydd when distanceToWater < 100', () => {
    const result = evaluateComplianceRules([], [], emptyGeo(), [], 50);

    expect(result.overallRisk).toBe('HIGH');
    expect(result.restrictions).toContain('Strandskydd');
    expect(result.permitProbability).toBeLessThanOrEqual(0.45);

    const rule = result.rules.find((r) => r.ruleId === 'MB_7_KAP_STRAND');
    expect(rule).toBeDefined();
  });

  it('does NOT flag Strandskydd when distanceToWater >= 100', () => {
    const result = evaluateComplianceRules([], [], emptyGeo(), [], 100);

    expect(result.restrictions).not.toContain('Strandskydd');
  });

  it('detects grundvatten vulnerability when value contains "hog"', () => {
    const geo = { ...emptyGeo(), groundwaterVulnerability: 'Hog sarbarhet' };
    const result = evaluateComplianceRules([], [], geo, []);

    expect(result.restrictions).toContain('Kansligt grundvatten');
    const rule = result.rules.find((r) => r.ruleId === 'MB_9_KAP_GRUNDVATTEN');
    expect(rule?.risk).toBe('MEDIUM');
  });

  it('detects SGU landslide indicator as MEDIUM by default', () => {
    const geo = {
      ...emptyGeo(),
      landslideFeatureHits: [{ featureLabel: 'Ravin', distanceMeters: 120 }],
      landslideRiskLevel: 'ADVISORY' as const,
    };
    const result = evaluateComplianceRules([], [], geo, []);

    expect(result.restrictions).toContain('SGU skred/ravinindikator');
    const rule = result.rules.find((r) => r.ruleId === 'SGU_SKRED_RAVIN_ADVISORY');
    expect(rule?.risk).toBe('MEDIUM');
  });

  it('detects SGU landslide indicator as HIGH when landslideRiskLevel=HIGH', () => {
    const geo = {
      ...emptyGeo(),
      landslideFeatureHits: [{ featureLabel: 'Skred', distanceMeters: 50 }],
      landslideRiskLevel: 'HIGH' as const,
    };
    const result = evaluateComplianceRules([], [], geo, []);

    const rule = result.rules.find((r) => r.ruleId === 'SGU_SKRED_RAVIN_ADVISORY');
    expect(rule?.risk).toBe('HIGH');
  });

  it('detects red-listed species (Artskydd)', () => {
    const result = evaluateComplianceRules(
      [{ name: 'Pilgrimsfalk', status: 'Rodlistad' }],
      [],
      emptyGeo(),
      [],
    );

    expect(result.restrictions).toContain('Artskydd');
    const rule = result.rules.find((r) => r.ruleId === 'ARTSKYDD_REG');
    expect(rule?.risk).toBe('MEDIUM');
  });

  it('detects Frid-status as Artskydd', () => {
    const result = evaluateComplianceRules([{ name: 'Lork', status: 'Fridlyst' }], [], emptyGeo(), []);

    expect(result.restrictions).toContain('Artskydd');
  });

  it('detects monument / fornlämning as HIGH risk', () => {
    const result = evaluateComplianceRules([], [], emptyGeo(), [
      { id: 'mon-1', name: 'Fornborg RAA 1', type: 'Fornlämning', distance: 50 },
    ]);

    expect(result.overallRisk).toBe('HIGH');
    expect(result.restrictions).toContain('Kulturmiljo');
    const rule = result.rules.find((r) => r.ruleId === 'KULTUR_RAA');
    expect(rule?.risk).toBe('HIGH');
    expect(result.permitProbability).toBeLessThanOrEqual(0.2);
  });

  it('BLOCK overrides HIGH in overallRisk', () => {
    const result = evaluateComplianceRules(
      [],
      [
        { id: 'area-1', type: 'naturreservat', name: 'Tyresta' },
        { id: 'area-2', type: 'Natura 2000', name: 'N2K test' },
      ],
      emptyGeo(),
      [{ id: 'mon-1', name: 'Fornborg', type: 'Fornlämning', distance: 30 }],
    );

    expect(result.overallRisk).toBe('BLOCK');
  });

  it('summary mentions restriction count and overall risk', () => {
    const result = evaluateComplianceRules(
      [],
      [{ id: 'area-1', type: 'naturreservat', name: 'R1' }],
      emptyGeo(),
      [],
    );

    expect(result.summary).toContain('1');
    expect(result.summary).toContain('BLOCK');
  });

  it('defaults distanceToWater to 200 (no strandskydd)', () => {
    // No distanceToWater argument → defaults to 200 → no strandskydd
    const result = evaluateComplianceRules([], [], emptyGeo(), []);
    expect(result.restrictions).not.toContain('Strandskydd');
  });
});
