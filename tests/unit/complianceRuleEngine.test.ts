import { describe, it, expect } from 'vitest';
import { evaluateComplianceRules } from '../../server/services/complianceRuleEngine';
import type { GeologicalData } from '../../server/services/sguService';
import type { ProtectedArea } from '../../server/services/nvrService';
import type { Monument } from '../../server/services/raaService';

// ── Helpers ───────────────────────────────────────────────────────────────────

const emptyGeo: GeologicalData = {
  groundwaterVulnerability: 'LOW',
  landslideFeatureHits: [],
  landslideRiskLevel: 'NONE',
  coverageMode: 'complete',
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
    const reservat: ProtectedArea[] = [{ type: 'Naturreservat', name: 'Stora Skogen', id: 'res-1' }];

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
    const natura: ProtectedArea[] = [{ type: 'Natura 2000', name: 'Havsbygden', id: 'n2k-1' }];

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
  });

  describe('strandskydd — unknown distance (NO_LEGACY_WATER_DISTANCE_FALLBACK_MECHANICAL_V1)', () => {
    // REBUILD-GATE-STATUS.md: "legacy fallback = 200 m ← DO NOT REINTRODUCE as spatial
    // semantics". A fabricated 200 m default does not read as "unknown" — it sits just outside
    // the < 100 m threshold above and so reads as "verified clear", silently suppressing a
    // Strandskydd flag that should have stayed unresolved. This unit is MECHANICAL ONLY: an
    // unknown distance must produce exactly main's un-flagged behaviour for this dimension —
    // no new rule, no new restriction string, no risk tier, no permitProbability change. What
    // "unknown" should actively communicate is a separate, later policy unit (W2).

    it('defaults distanceToWater to null (unknown), never to a numeric distance', () => {
      const result = evaluateComplianceRules(noObs, noAreas, emptyGeo, noMonuments);
      expect(result.restrictions).not.toContain('Strandskydd');
      expect(result.rules.find((r) => r.ruleId === 'MB_7_KAP_STRAND')).toBeUndefined();
    });

    it('does NOT fire the Strandskydd rule when distance is explicitly null', () => {
      const result = evaluateComplianceRules(noObs, noAreas, emptyGeo, noMonuments, null);
      expect(result.restrictions).not.toContain('Strandskydd');
      expect(result.rules.find((r) => r.ruleId === 'MB_7_KAP_STRAND')).toBeUndefined();
    });

    it('does NOT fire the Strandskydd rule when distance is NaN (JS: NaN < 100 is false, but guard explicitly, do not rely on it)', () => {
      const result = evaluateComplianceRules(noObs, noAreas, emptyGeo, noMonuments, NaN);
      expect(result.restrictions).not.toContain('Strandskydd');
      expect(result.rules.find((r) => r.ruleId === 'MB_7_KAP_STRAND')).toBeUndefined();
    });

    it('does NOT fire the Strandskydd rule when distance is +Infinity (non-finite is not a measured distance)', () => {
      const result = evaluateComplianceRules(noObs, noAreas, emptyGeo, noMonuments, Infinity);
      expect(result.restrictions).not.toContain('Strandskydd');
      expect(result.rules.find((r) => r.ruleId === 'MB_7_KAP_STRAND')).toBeUndefined();
      expect(result.rules.some((r) => r.description.includes('Infinity'))).toBe(false);
      expect(result.overallRisk).toBe('LOW');
      expect(result.permitProbability).toBe(0.95);
    });

    it('does NOT fire the Strandskydd rule when distance is -Infinity (JS: -Infinity < 100 is true — the guard must reject it before the comparison, not rely on the comparison)', () => {
      // Same failure mode as the `null < 100` pitfall, different value: on a naive
      // pass-through, -Infinity satisfies the < 100 threshold directly (no coercion needed)
      // and would fabricate a HIGH Strandskydd finding reading "Avstand till vatten ar
      // -Infinity m". Number.isFinite() rejects both null and ±Infinity at the same guard,
      // before the comparison is ever reached.
      const result = evaluateComplianceRules(noObs, noAreas, emptyGeo, noMonuments, -Infinity);
      expect(result.restrictions).not.toContain('Strandskydd');
      expect(result.rules.find((r) => r.ruleId === 'MB_7_KAP_STRAND')).toBeUndefined();
      expect(result.rules.some((r) => r.description.includes('Infinity'))).toBe(false);
      expect(result.overallRisk).toBe('LOW');
      expect(result.permitProbability).toBe(0.95);
    });

    it('treats an explicitly passed undefined exactly like an omitted argument (default null, never a numeric distance)', () => {
      // JS default-parameter semantics only substitute the default for undefined, never for
      // other falsy values — proving this explicitly rather than trusting the language spec,
      // since it is exactly the kind of assumption a future refactor could quietly break.
      const result = evaluateComplianceRules(noObs, noAreas, emptyGeo, noMonuments, undefined);
      expect(result.restrictions).not.toContain('Strandskydd');
      expect(result.rules.find((r) => r.ruleId === 'MB_7_KAP_STRAND')).toBeUndefined();
      expect(result.overallRisk).toBe('LOW');
      expect(result.permitProbability).toBe(0.95);
    });

    it('positive control: a finite measured 150 m is still evaluated by the threshold unchanged (the fix touches only the unknown/non-finite path)', () => {
      const result = evaluateComplianceRules(noObs, noAreas, emptyGeo, noMonuments, 150);
      expect(result.restrictions).not.toContain('Strandskydd');
      expect(result.rules.find((r) => r.ruleId === 'MB_7_KAP_STRAND')).toBeUndefined();
      expect(result.overallRisk).toBe('LOW');
      expect(result.permitProbability).toBe(0.95);
    });

    it('does NOT fabricate any distance-dependent text when distance is null', () => {
      // Guards against `Avstand till vatten ar null m` — the JS pitfall where a naive
      // `null < 100` comparison is `true` (null coerces to 0) and would fabricate a HIGH
      // Strandskydd finding with a nonsensical "null m" description.
      const result = evaluateComplianceRules(noObs, noAreas, emptyGeo, noMonuments, null);
      expect(result.rules.some((r) => r.description.includes('null'))).toBe(false);
      expect(result.overallRisk).toBe('LOW');
      expect(result.permitProbability).toBe(0.95);
    });

    it('an unknown distance does not change overallRisk/permitProbability/restrictions/rules at all relative to main (mechanical parity)', () => {
      // With a CONFIRMED restriction present (Naturreservat), an unknown water distance must
      // not add, remove, or alter anything else in the result — mechanical-only means zero
      // observable difference outside the Strandskydd dimension itself.
      const reservat: ProtectedArea[] = [{ type: 'Naturreservat', name: 'X', id: 'res-unknown-dist' }];
      const withKnownFar = evaluateComplianceRules(noObs, reservat, emptyGeo, noMonuments, 500);
      const withUnknown = evaluateComplianceRules(noObs, reservat, emptyGeo, noMonuments, null);
      expect(withUnknown.overallRisk).toBe(withKnownFar.overallRisk);
      expect(withUnknown.permitProbability).toBe(withKnownFar.permitProbability);
      expect(withUnknown.restrictions).toEqual(withKnownFar.restrictions);
      expect(withUnknown.rules.map((r) => r.ruleId)).toEqual(withKnownFar.rules.map((r) => r.ruleId));
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
        landslideRiskLevel: 'ADVISORY',
        coverageMode: 'complete',
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
        coverageMode: 'complete',
      };
      const result = evaluateComplianceRules(noObs, noAreas, geo, noMonuments, 200);
      const rule = result.rules.find((r) => r.ruleId === 'SGU_SKRED_RAVIN_ADVISORY');
      expect(rule?.risk).toBe('HIGH');
    });

    it('mentions sample coverage in description when coverageMode is "sample"', () => {
      const geo: GeologicalData = {
        ...emptyGeo,
        landslideFeatureHits: [{ featureLabel: 'X', distanceMeters: 10 }],
        landslideRiskLevel: 'ADVISORY',
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
    const monuments: Monument[] = [
      { name: 'Gravfält Stormossen', id: 'RA-001', type: 'Fornlämning', distance: 50 },
    ];

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
      const reservat: ProtectedArea[] = [{ type: 'Naturreservat', name: 'X', id: 'res-x' }];
      const monuments: Monument[] = [{ name: 'Y', id: 'RA-002', type: 'Fornlämning', distance: 10 }];
      const result = evaluateComplianceRules(noObs, reservat, emptyGeo, monuments, 200);
      expect(result.permitProbability).toBe(0.05);
    });
  });

  describe('summary and rule counting', () => {
    it('summary reflects restriction count and overall risk', () => {
      const reservat: ProtectedArea[] = [{ type: 'Naturreservat', name: 'Testskog', id: 'res-sum' }];
      const result = evaluateComplianceRules(noObs, reservat, emptyGeo, noMonuments, 200);
      expect(result.summary).toContain('1');
      expect(result.summary).toContain('BLOCK');
    });
  });
});
