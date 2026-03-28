import { describe, it, expect } from 'vitest';
import { evaluateComplianceRules, type SiteAnalysis } from '../../server/services/complianceRuleEngine';
import type { GeologicalData } from '../../server/services/sguService';
import type { ProtectedArea } from '../../server/services/nvrService';
import type { Monument } from '../../server/services/raaService';

describe('complianceRuleEngine', () => {
  const emptyAnalysis: SiteAnalysis = {
    overallRisk: 'LOW',
    permitProbability: 0.95,
    restrictions: [],
    rules: [],
    summary: 'Analysen identifierade 0 restriktioner eller varningssignaler. Samlad riskklassning: LOW.',
  };

  it('should return LOW risk when no rules are triggered', () => {
    const analysis = evaluateComplianceRules([], [], {} as GeologicalData, [], 200);
    expect(analysis).toEqual(emptyAnalysis);
  });

  it('should trigger naturreservat rule', () => {
    const protectedAreas = [
      { id: '1', name: 'Test Reserve', type: 'naturreservat', url: '' } as ProtectedArea,
    ];
    const analysis = evaluateComplianceRules([], protectedAreas, {} as GeologicalData, []);
    expect(analysis.overallRisk).toBe('BLOCK');
    expect(analysis.permitProbability).toBe(0.05);
    expect(analysis.restrictions).toContain('Naturreservat');
    expect(analysis.rules[0].ruleId).toBe('MB_7_KAP_RESERVAT');
  });

  it('should trigger Natura 2000 rule', () => {
    const protectedAreas = [
      { id: '1', name: 'Test Natura 2000', type: 'natura 2000-omrade', url: '' } as ProtectedArea,
    ];
    const analysis = evaluateComplianceRules([], protectedAreas, {} as GeologicalData, []);
    expect(analysis.overallRisk).toBe('HIGH');
    expect(analysis.permitProbability).toBe(0.25);
    expect(analysis.restrictions).toContain('Natura 2000');
    expect(analysis.rules[0].ruleId).toBe('MB_7_KAP_N2K');
  });

  it('should trigger strandskydd rule', () => {
    const analysis = evaluateComplianceRules([], [], {} as GeologicalData, [], 50);
    expect(analysis.overallRisk).toBe('HIGH');
    expect(analysis.permitProbability).toBe(0.45);
    expect(analysis.restrictions).toContain('Strandskydd');
    expect(analysis.rules[0].ruleId).toBe('MB_7_KAP_STRAND');
  });

  it('should trigger grundvatten rule', () => {
    const geological = { groundwaterVulnerability: 'Hog' } as GeologicalData;
    const analysis = evaluateComplianceRules([], [], geological, []);
    expect(analysis.overallRisk).toBe('MEDIUM');
    expect(analysis.permitProbability).toBe(0.7);
    expect(analysis.restrictions).toContain('Kansligt grundvatten');
    expect(analysis.rules[0].ruleId).toBe('MB_9_KAP_GRUNDVATTEN');
  });

  it('should trigger skred/ravin rule', () => {
    const geological = {
      landslideFeatureHits: [{ featureCode: 1, featureLabel: 'Skred', distanceMeters: 50 }],
      landslideRiskLevel: 'HIGH',
      coverageMode: 'complete',
    } as unknown as GeologicalData;
    const analysis = evaluateComplianceRules([], [], geological, []);
    expect(analysis.overallRisk).toBe('HIGH');
    expect(analysis.permitProbability).toBe(0.6);
    expect(analysis.restrictions).toContain('SGU skred/ravinindikator');
    expect(analysis.rules[0].ruleId).toBe('SGU_SKRED_RAVIN_ADVISORY');
  });

  it('should trigger artskydd rule', () => {
    const observations = [{ name: 'Testart', status: 'Rodlistad' } as any];
    const analysis = evaluateComplianceRules(observations, [], {} as GeologicalData, []);
    expect(analysis.overallRisk).toBe('MEDIUM');
    expect(analysis.restrictions).toContain('Artskydd');
    expect(analysis.rules[0].ruleId).toBe('ARTSKYDD_REG');
  });

  it('should trigger kulturmiljo rule', () => {
    const monuments = [
      { id: '1', name: 'Test Monument', type: 'Fornlamning', url: '', distance: 10 } as Monument,
    ];
    const analysis = evaluateComplianceRules([], [], {} as GeologicalData, monuments);
    expect(analysis.overallRisk).toBe('HIGH');
    expect(analysis.permitProbability).toBe(0.2);
    expect(analysis.restrictions).toContain('Kulturmiljo');
    expect(analysis.rules[0].ruleId).toBe('KULTUR_RAA');
  });

  it('should handle multiple rules and select the highest risk and lowest probability', () => {
    const protectedAreas = [
      { id: '1', name: 'Test Natura 2000', type: 'natura 2000-omrade', url: '' } as ProtectedArea,
    ];
    const monuments = [
      { id: '1', name: 'Test Monument', type: 'Fornlamning', url: '', distance: 10 } as Monument,
    ];
    const geological = { groundwaterVulnerability: 'Hog' } as GeologicalData;

    const analysis = evaluateComplianceRules([], protectedAreas, geological, monuments);

    // "Kulturmiljo" comes before "Natura 2000" in the probability check, so it should be 0.2
    expect(analysis.permitProbability).toBe(0.2);
    // It has HIGH and MEDIUM risks, so overall should be HIGH
    expect(analysis.overallRisk).toBe('HIGH');
    expect(analysis.restrictions).toHaveLength(3);
  });

  it('should correctly calculate permitProbability with multiple restrictions', () => {
    const geological = {
      landslideFeatureHits: [{ featureCode: 1, featureLabel: 'Skred', distanceMeters: 50 }],
      landslideRiskLevel: 'LOW',
      coverageMode: 'complete',
    } as unknown as GeologicalData;
    const analysis = evaluateComplianceRules([], [], geological, [], 150);
    expect(analysis.permitProbability).toBe(0.6); // SGU skred/ravinindikator is chosen over strandskydd
  });

  it('should correctly calculate overallRisk with multiple rules', () => {
    const geological = { groundwaterVulnerability: 'Hog' } as GeologicalData;
    const observations = [{ name: 'Testart', status: 'Rodlistad' } as any];
    const analysis = evaluateComplianceRules(observations, [], geological, []);
    expect(analysis.overallRisk).toBe('MEDIUM');
  });
});
