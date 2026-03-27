import { describe, it, expect } from 'vitest';
import { evaluateComplianceRules } from '../../server/services/complianceRuleEngine';
import type { GeologicalData } from '../../server/services/sguService';
import type { ProtectedArea } from '../../server/services/nvrService';
import type { Monument } from '../../server/services/raaService';

// ── Helpers ───────────────────────────────────────────────────────────────────

const emptyGeo: GeologicalData = {
  groundwaterVulnerability: 'LOW',
  landslideFeatureHits: [],
  landslideRiskLevel: 'LOW',
  coverageMode: 'full',
};

const noAreas: ProtectedArea[] = [];
const noMonuments: Monument[] = [];
const noObs: Array<{ name?: string; status?: string }> = [];

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('evaluateComplianceRules', () => {
  describe('clean site (no restrictions)', () => {
    it('returns LOW risk with no rules and 0.95 permit probability', () => {
      const result = evaluateComplianceRules(noObs, noAreas, emptyGeo, noMonuments, 200);

      expect(result.overallRisk).toBe('LOW');
      expect(result.permitProbability).toBe(0.95);
      expect(result.restrictions).toHaveLength(0);
      expect(result.rules).toHaveLength(0);
    });

    it('summary mentions 0 restrictions', () => {
      const result = evaluateComplianceRules(noObs, noAreas, emptyGeo, noMonuments, 200);
      expect(result.summary).toContain('0');
    });
  });

  describe('naturreservat (BLOCK)', () => {
    const reservat: ProtectedArea[] = [{ type: 'Naturreservat', name: 'Stora Skogen' }];

    it('returns BLOCK overall risk', () => {
      const result = evaluateComplianceRules(noObs, reservat, emptyGeo, noMonuments, 200);
      expect(result.overallRisk).toBe('BLOCK');
    });

    it('sets permitProbability to 0.05', () => {
      const result = evaluateComplianceRules(noObs, reservat, emptyGeo, noMonuments, 200);
      expect(result.permitProbability).toBe(0.05);
    });

    it('adds MB_7_KAP_RESERVAT rule', () => {
      const result = evaluateComplianceRules(noObs, reservat, emptyGeo, noMonuments, 200);
      const rule = result.rules.find((r) => r.ruleId === 'MB_7_KAP_RESERVAT');
      expect(rule).toBeDefined();
      expect(rule?.risk).toBe('BLOCK');
      expect(rule?.chapter).toBe('7 kap MB');
    });

    it('adds "Naturreservat" to restrictions', () => {
      const result = evaluateComplianceRules(noObs, reservat, emptyGeo, noMonuments, 200);
      expect(result.restrictions).toContain('Naturreservat');
    });
  });

  describe('Natura 2000 (HIGH)', () => {
    const natura: ProtectedArea[] = [{ type: 'Natura 2000', name: 'Havsbygden' }];

    it('returns HIGH overall risk', () => {
      const result = evaluateComplianceRules(noObs, natura, emptyGeo, noMonuments, 200);
      expect(result.overallRisk).toBe('HIGH');
    });

    it('sets permitProbability to 0.25', () => {
      const result = evaluateComplianceRules(noObs, natura, emptyGeo, noMonuments, 200);
      expect(result.permitProbability).toBe(0.25);
    });

    it('adds MB_7_KAP_N2K rule', () => {
      const result = evaluateComplianceRules(noObs, natura, emptyGeo, noMonuments, 200);
      const rule = result.rules.find((r) => r.ruleId === 'MB_7_KAP_N2K');
      expect(rule).toBeDefined();
      expect(rule?.risk).toBe('HIGH');
    });
  });

  describe('strandskydd (HIGH)', () => {
    it('triggers when distance < 100 m', () => {
      const result = evaluateComplianceRules(noObs, noAreas, emptyGeo, noMonuments, 50);
      expect(result.restrictions).toContain('Strandskydd');
      const rule = result.rules.find((r) => r.ruleId === 'MB_7_KAP_STRAND');
      expect(rule?.risk).toBe('HIGH');
      expect(result.permitProbability).toBe(0.45);
    });

    it('does NOT trigger when distance is exactly 100 m', () => {
      const result = evaluateComplianceRules(noObs, noAreas, emptyGeo, noMonuments, 100);
      expect(result.restrictions).not.toContain('Strandskydd');
    });

    it('does NOT trigger when distance > 100 m', () => {
      const result = evaluateComplianceRules(noObs, noAreas, emptyGeo, noMonuments, 200);
      expect(result.restrictions).not.toContain('Strandskydd');
    });

    it('defaults distanceToWater to 200 m (no strandskydd)', () => {
      const result = evaluateComplianceRules(noObs, noAreas, emptyGeo, noMonuments);
      expect(result.restrictions).not.toContain('Strandskydd');
    });
  });

  describe('grundvatten (MEDIUM)', () => {
    const highGw: GeologicalData = { ...emptyGeo, groundwaterVulnerability: 'Hog sarbarhet' };

    it('triggers when groundwaterVulnerability contains "hog" (case-insensitive)', () => {
      const result = evaluateComplianceRules(noObs, noAreas, highGw, noMonuments, 200);
      expect(result.restrictions).toContain('Kansligt grundvatten');
      const rule = result.rules.find((r) => r.ruleId === 'MB_9_KAP_GRUNDVATTEN');
      expect(rule?.risk).toBe('MEDIUM');
    });

    it('does NOT trigger for low groundwater vulnerability', () => {
      const result = evaluateComplianceRules(noObs, noAreas, emptyGeo, noMonuments, 200);
      expect(result.restrictions).not.toContain('Kansligt grundvatten');
    });

    it('sets permitProbability to 0.70', () => {
      const result = evaluateComplianceRules(noObs, noAreas, highGw, noMonuments, 200);
      expect(result.permitProbability).toBe(0.7);
    });
  });

  describe('SGU skred/ravin (MEDIUM/HIGH)', () => {
    it('triggers when landslideFeatureHits is non-empty — MEDIUM when landslideRiskLevel != HIGH', () => {
      const geo: GeologicalData = {
        ...emptyGeo,
        landslideFeatureHits: [{ featureLabel: 'Ravindal', distanceMeters: 45.2 }],
        landslideRiskLevel: 'MEDIUM',
        coverageMode: 'full',
      };
      const result = evaluateComplianceRules(noObs, noAreas, geo, noMonuments, 200);
      const rule = result.rules.find((r) => r.ruleId === 'SGU_SKRED_RAVIN_ADVISORY');
      expect(rule?.risk).toBe('MEDIUM');
      expect(result.restrictions).toContain('SGU skred/ravinindikator');
    });

    it('sets risk to HIGH when landslideRiskLevel === HIGH', () => {
      const geo: GeologicalData = {
        ...emptyGeo,
        landslideFeatureHits: [{ featureLabel: 'Skredzon', distanceMeters: 10 }],
        landslideRiskLevel: 'HIGH',
        coverageMode: 'full',
      };
      const result = evaluateComplianceRules(noObs, noAreas, geo, noMonuments, 200);
      const rule = result.rules.find((r) => r.ruleId === 'SGU_SKRED_RAVIN_ADVISORY');
      expect(rule?.risk).toBe('HIGH');
    });

    it('mentions sample coverage in description when coverageMode is "sample"', () => {
      const geo: GeologicalData = {
        ...emptyGeo,
        landslideFeatureHits: [{ featureLabel: 'X', distanceMeters: 10 }],
        landslideRiskLevel: 'LOW',
        coverageMode: 'sample',
      };
      const result = evaluateComplianceRules(noObs, noAreas, geo, noMonuments, 200);
      const rule = result.rules.find((r) => r.ruleId === 'SGU_SKRED_RAVIN_ADVISORY');
      expect(rule?.description).toContain('stickprovslage');
    });
  });

  describe('artskydd (MEDIUM)', () => {
    it('triggers for "Rod"-listed species', () => {
      const obs = [{ name: 'Lav A', status: 'Rodlistad' }];
      const result = evaluateComplianceRules(obs, noAreas, emptyGeo, noMonuments, 200);
      const rule = result.rules.find((r) => r.ruleId === 'ARTSKYDD_REG');
      expect(rule?.risk).toBe('MEDIUM');
      expect(result.restrictions).toContain('Artskydd');
    });

    it('triggers for "Frid"-listed species', () => {
      const obs = [{ name: 'Orm X', status: 'Fridlyst' }];
      const result = evaluateComplianceRules(obs, noAreas, emptyGeo, noMonuments, 200);
      expect(result.restrictions).toContain('Artskydd');
    });

    it('does NOT trigger for unlisted species', () => {
      const obs = [{ name: 'Vanlig Sparv', status: 'Livskraftig' }];
      const result = evaluateComplianceRules(obs, noAreas, emptyGeo, noMonuments, 200);
      expect(result.restrictions).not.toContain('Artskydd');
    });

    it('uses "okand art" in description when species name is missing', () => {
      const obs = [{ status: 'Rodlistad' }];
      const result = evaluateComplianceRules(obs, noAreas, emptyGeo, noMonuments, 200);
      const rule = result.rules.find((r) => r.ruleId === 'ARTSKYDD_REG');
      expect(rule?.description).toContain('okand art');
    });
  });

  describe('kulturmiljo/fornlämningar (HIGH)', () => {
    const monuments: Monument[] = [{ name: 'Gravfält Stormossen', id: 'RA-001' }];

    it('returns HIGH overall risk', () => {
      const result = evaluateComplianceRules(noObs, noAreas, emptyGeo, monuments, 200);
      expect(result.overallRisk).toBe('HIGH');
    });

    it('sets permitProbability to 0.20', () => {
      const result = evaluateComplianceRules(noObs, noAreas, emptyGeo, monuments, 200);
      expect(result.permitProbability).toBe(0.2);
    });

    it('adds KULTUR_RAA rule', () => {
      const result = evaluateComplianceRules(noObs, noAreas, emptyGeo, monuments, 200);
      const rule = result.rules.find((r) => r.ruleId === 'KULTUR_RAA');
      expect(rule).toBeDefined();
      expect(rule?.risk).toBe('HIGH');
    });
  });

  describe('priority of permitProbability when multiple restrictions', () => {
    it('naturreservat takes precedence over kulturmiljo (0.05)', () => {
      const reservat: ProtectedArea[] = [{ type: 'Naturreservat', name: 'X' }];
      const monuments: Monument[] = [{ name: 'Y', id: 'RA-002' }];
      const result = evaluateComplianceRules(noObs, reservat, emptyGeo, monuments, 200);
      expect(result.permitProbability).toBe(0.05);
    });
  });

  describe('summary and rule counting', () => {
    it('summary reflects restriction count and overall risk', () => {
      const reservat: ProtectedArea[] = [{ type: 'Naturreservat', name: 'Testskog' }];
      const result = evaluateComplianceRules(noObs, reservat, emptyGeo, noMonuments, 200);
      expect(result.summary).toContain('1');
      expect(result.summary).toContain('BLOCK');
    });
  });
});
