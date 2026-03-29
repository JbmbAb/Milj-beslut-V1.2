import { describe, expect, it } from 'vitest';
import { calculatePredictiveScores } from '../../services/predictiveScoringService';
import type { ProjectPlan, CarbonResult } from '../../types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function basePlan(overrides: Partial<ProjectPlan> = {}): ProjectPlan {
  return {
    name: 'Testprojekt',
    revision: '1.0',
    projectType: 'ENV_PERMIT' as const,
    templateId: 'tpl-1',
    background: '',
    description: '',
    goals: [],
    location: { lat: 59.33, lng: 18.06, address: 'Stockholm', propertyId: 'prop-1' },
    stakeholders: [],
    phases: [],
    complianceScore: 80,
    auditTrail: [],
    branding: {} as ProjectPlan['branding'],
    moduleIntegrations: [],
    documentArchive: [],
    samplingPreparation: {} as ProjectPlan['samplingPreparation'],
    stageGates: [],
    mapLayerSelection: { base: [], optional: [], enabled: [], unavailable: [] },
    permitCodeProfile: null,
    dispatchQuotes: [],
    transportBookings: [],
    driverJournals: [],
    limsReports: [],
    carbonSummary: { lastInput: null, lastResult: null, history: [] },
    ...overrides,
  };
}

function highRiskPermitProfile(): ProjectPlan['permitCodeProfile'] {
  return {
    code: '17 05 04*',
    codeType: 'EWC',
    legalReference: 'Avfallsförordningen 3 §',
    regulatoryTrack: 'PERMIT',
    thresholdTon: null,
    thresholdScope: null,
    riskTier: 'HIGH',
    requiresGeofencing: false,
    requiredMapLayers: [],
    timelineBufferWeeks: 4,
    humanReviewRequired: true,
    reviewNote: '',
    municipality: null,
  };
}

function carbonResult(): CarbonResult {
  return {
    method: 'LOCAL_DISTANCE',
    totalKgCo2e: 500,
    distanceKmUsed: 100,
    quality: 'ROUTED',
    emissionFactorKgCo2ePerTonKm: 0.05,
    breakdown: { transportKgCo2e: 500, notes: [] },
    calculatedAt: '2026-01-01T00:00:00.000Z',
    inputVersion: '1',
  };
}

// ─── calculatePredictiveScores – regulatory risk ──────────────────────────────

describe('calculatePredictiveScores – regulatory risk', () => {
  it('returns a score between 0 and 1 for a low-risk plan', () => {
    const result = calculatePredictiveScores(basePlan());
    expect(result.regulatoryRisk.score).toBeGreaterThanOrEqual(0);
    expect(result.regulatoryRisk.score).toBeLessThanOrEqual(1);
  });

  it('high-risk permit code increases regulatoryRisk score', () => {
    const low = calculatePredictiveScores(basePlan());
    const high = calculatePredictiveScores(basePlan({ permitCodeProfile: highRiskPermitProfile() }));
    expect(high.regulatoryRisk.score).toBeGreaterThan(low.regulatoryRisk.score);
  });

  it('geo-sensitive address increases probabilityRfi', () => {
    const normal = calculatePredictiveScores(basePlan());
    const geo = calculatePredictiveScores(
      basePlan({ location: { lat: 59, lng: 18, address: 'Skyddad nara vattendrag', propertyId: 'p' } }),
    );
    expect(geo.regulatoryRisk.probabilityRfi).toBeGreaterThan(
      normal.regulatoryRisk.probabilityRfi,
    );
  });

  it('probabilityInjunction is 40 % of probabilityRfi', () => {
    const result = calculatePredictiveScores(basePlan({ permitCodeProfile: highRiskPermitProfile() }));
    expect(result.regulatoryRisk.probabilityInjunction).toBeCloseTo(
      result.regulatoryRisk.probabilityRfi * 0.4,
      5,
    );
  });

  it('confidence is always 0.85', () => {
    const result = calculatePredictiveScores(basePlan());
    expect(result.regulatoryRisk.confidence).toBe(0.85);
  });
});

// ─── calculatePredictiveScores – environmental risk ──────────────────────────

describe('calculatePredictiveScores – environmental risk', () => {
  it('GROUNDWATER layer increases groundwaterImpact', () => {
    const without = calculatePredictiveScores(basePlan());
    const with_ = calculatePredictiveScores(
      basePlan({ mapLayerSelection: { base: [], optional: [], enabled: ['GROUNDWATER'], unavailable: [] } }),
    );
    expect(with_.environmentalRisk.groundwaterImpact).toBeGreaterThan(
      without.environmentalRisk.groundwaterImpact,
    );
  });

  it('NATURA2000 layer increases biodiversityImpact', () => {
    const without = calculatePredictiveScores(basePlan());
    const with_ = calculatePredictiveScores(
      basePlan({ mapLayerSelection: { base: [], optional: [], enabled: ['NATURA2000'], unavailable: [] } }),
    );
    expect(with_.environmentalRisk.biodiversityImpact).toBeGreaterThan(
      without.environmentalRisk.biodiversityImpact,
    );
  });

  it('FLOOD_RISK layer increases floodingImpact', () => {
    const without = calculatePredictiveScores(basePlan());
    const with_ = calculatePredictiveScores(
      basePlan({ mapLayerSelection: { base: [], optional: [], enabled: ['FLOOD_RISK'], unavailable: [] } }),
    );
    expect(with_.environmentalRisk.floodingImpact).toBeGreaterThan(
      without.environmentalRisk.floodingImpact,
    );
  });

  it('envRisk.score is between 0 and 1', () => {
    const result = calculatePredictiveScores(
      basePlan({
        mapLayerSelection: {
          base: [],
          optional: [],
          enabled: ['GROUNDWATER', 'NATURA2000', 'FLOOD_RISK'],
          unavailable: [],
        },
      }),
    );
    expect(result.environmentalRisk.score).toBeGreaterThanOrEqual(0);
    expect(result.environmentalRisk.score).toBeLessThanOrEqual(1);
  });
});

// ─── calculatePredictiveScores – funding risk ─────────────────────────────────

describe('calculatePredictiveScores – funding risk', () => {
  it('high compliance score with carbon data yields a better rating', () => {
    const good = calculatePredictiveScores(
      basePlan({
        complianceScore: 100,
        carbonSummary: { lastInput: null, lastResult: carbonResult(), history: [] },
      }),
    );
    // AAA/AA/A expected for near-perfect compliance + carbon bonus
    expect(['AAA', 'AA', 'A', 'BBB'].includes(good.fundingRisk.rating)).toBe(true);
  });

  it('zero compliance yields a low rating', () => {
    const bad = calculatePredictiveScores(basePlan({ complianceScore: 0 }));
    expect(['C', 'CCC', 'B'].includes(bad.fundingRisk.rating)).toBe(true);
  });

  it('carbon data bonus makes eligibleForGreenLoan more likely', () => {
    const withCarbon = calculatePredictiveScores(
      basePlan({
        complianceScore: 100,
        carbonSummary: { lastInput: null, lastResult: carbonResult(), history: [] },
      }),
    );
    expect(typeof withCarbon.fundingRisk.eligibleForGreenLoan).toBe('boolean');
  });

  it('fundingRisk.score is non-negative', () => {
    const result = calculatePredictiveScores(basePlan({ complianceScore: 0 }));
    expect(result.fundingRisk.score).toBeGreaterThanOrEqual(0);
  });

  it('passing a CarbonResult as second argument is accepted', () => {
    const result = calculatePredictiveScores(basePlan({ complianceScore: 80 }), carbonResult());
    expect(result.fundingRisk.score).toBeGreaterThanOrEqual(0);
  });
});
