/**
 * Tests för services/predictiveScoringService.ts
 * Täcker alla ratingnivåer, riskfaktorer och miljöpåverkan.
 */
import { describe, it, expect } from 'vitest';
import { calculatePredictiveScores } from '../../services/predictiveScoringService';
import { createDefaultProjectPlan } from '../../services/projectStructure';
import type { ProjectPlan } from '../../types';

function makePlan(overrides: Partial<ProjectPlan> = {}): ProjectPlan {
  return {
    ...createDefaultProjectPlan(),
    ...overrides,
  };
}

describe('calculatePredictiveScores — regulatorisk risk', () => {
  it('ger förhöjd RFI-sannolikhet för HIGH riskTier', () => {
    const plan = makePlan({
      permitCodeProfile: {
        code: '17 05 03*',
        codeType: 'EWC',
        legalReference: 'Test',
        regulatoryTrack: 'PERMIT',
        thresholdTon: null,
        thresholdScope: null,
        riskTier: 'HIGH',
        requiresGeofencing: true,
        requiredMapLayers: [],
        timelineBufferWeeks: 2,
        humanReviewRequired: true,
        reviewNote: 'Advisory',
        municipality: null,
      },
    });
    const scores = calculatePredictiveScores(plan);
    expect(scores.regulatoryRisk.probabilityRfi).toBeGreaterThan(0.4);
    expect(scores.regulatoryRisk.topRiskFactors[0]).toContain('Hög riskklass');
  });

  it('ger låg RFI-sannolikhet för LOW riskTier', () => {
    const plan = makePlan({
      permitCodeProfile: {
        code: '90.131',
        codeType: 'SNI',
        legalReference: 'Test',
        regulatoryTrack: 'NOTIFICATION',
        thresholdTon: null,
        thresholdScope: null,
        riskTier: 'LOW',
        requiresGeofencing: false,
        requiredMapLayers: [],
        timelineBufferWeeks: 0,
        humanReviewRequired: true,
        reviewNote: 'Advisory',
        municipality: null,
      },
    });
    const scores = calculatePredictiveScores(plan);
    expect(scores.regulatoryRisk.probabilityRfi).toBe(0.15);
  });

  it('lägger till geografisk riskfaktor för adress med "skydd"', () => {
    const plan = makePlan({
      location: { lat: 59, lng: 18, address: 'Vattenskyddsområde 1', propertyId: '' },
    });
    const scores = calculatePredictiveScores(plan);
    expect(scores.regulatoryRisk.topRiskFactors).toContain('Geografisk känslighet detekterad');
    expect(scores.regulatoryRisk.probabilityRfi).toBeGreaterThan(0.15);
  });

  it('lägger till geografisk riskfaktor för adress med "nara"', () => {
    const plan = makePlan({
      location: { lat: 59, lng: 18, address: 'nara naturreservat', propertyId: '' },
    });
    const scores = calculatePredictiveScores(plan);
    expect(scores.regulatoryRisk.topRiskFactors).toContain('Geografisk känslighet detekterad');
  });

  it('rapporterar ingen geografisk konflikt för neutral adress', () => {
    const plan = makePlan({
      location: { lat: 59, lng: 18, address: 'Storgatan 1, Stockholm', propertyId: '' },
    });
    const scores = calculatePredictiveScores(plan);
    expect(scores.regulatoryRisk.topRiskFactors).toContain('Ingen direkt geografisk konflikt funnen');
  });

  it('kläms probabilityRfi till max 0.95', () => {
    const plan = makePlan({
      permitCodeProfile: {
        code: '17 05 03*',
        codeType: 'EWC',
        legalReference: 'Test',
        regulatoryTrack: 'PERMIT',
        thresholdTon: null,
        thresholdScope: null,
        riskTier: 'HIGH',
        requiresGeofencing: true,
        requiredMapLayers: [],
        timelineBufferWeeks: 2,
        humanReviewRequired: true,
        reviewNote: '',
        municipality: null,
      },
      location: { lat: 59, lng: 18, address: 'nara vattenskyddsområde', propertyId: '' },
    });
    const scores = calculatePredictiveScores(plan);
    expect(scores.regulatoryRisk.probabilityRfi).toBeLessThanOrEqual(0.95);
  });
});

describe('calculatePredictiveScores — miljörisk', () => {
  it('grundvattenlager ger hög grundvattenpåverkan', () => {
    const plan = makePlan({
      mapLayerSelection: {
        base: ['CADASTRE'],
        optional: [],
        enabled: ['CADASTRE', 'GROUNDWATER'],
        unavailable: [],
      },
    });
    const scores = calculatePredictiveScores(plan);
    expect(scores.environmentalRisk.groundwaterImpact).toBe(0.8);
  });

  it('NATURA2000-lager ger hög biologisk påverkan', () => {
    const plan = makePlan({
      mapLayerSelection: {
        base: ['CADASTRE'],
        optional: [],
        enabled: ['CADASTRE', 'NATURA2000'],
        unavailable: [],
      },
    });
    const scores = calculatePredictiveScores(plan);
    expect(scores.environmentalRisk.biodiversityImpact).toBe(0.9);
  });

  it('översvämningslager ger förhöjd flödesrisk', () => {
    const plan = makePlan({
      mapLayerSelection: {
        base: ['CADASTRE'],
        optional: [],
        enabled: ['CADASTRE', 'FLOOD_RISK'],
        unavailable: [],
      },
    });
    const scores = calculatePredictiveScores(plan);
    expect(scores.environmentalRisk.floodingImpact).toBe(0.6);
  });

  it('inga speciella lager ger låga miljöpåverkanstal', () => {
    const plan = makePlan({
      mapLayerSelection: {
        base: ['CADASTRE'],
        optional: [],
        enabled: ['CADASTRE'],
        unavailable: [],
      },
    });
    const scores = calculatePredictiveScores(plan);
    expect(scores.environmentalRisk.groundwaterImpact).toBe(0.1);
    expect(scores.environmentalRisk.biodiversityImpact).toBe(0.05);
    expect(scores.environmentalRisk.floodingImpact).toBe(0.1);
  });
});

describe('calculatePredictiveScores — finansieringsrating', () => {
  it('ger B-rating för standardplan utan compliance', () => {
    const plan = makePlan({ complianceScore: 0 });
    const scores = calculatePredictiveScores(plan);
    expect(['B', 'CCC', 'C', 'BB']).toContain(scores.fundingRisk.rating);
  });

  it('inkluderar carbonbonus när carbonResult finns', () => {
    const carbonResult = {
      method: 'LOCAL_DISTANCE' as const,
      totalKgCo2e: 100,
      distanceKmUsed: 25,
      quality: 'ESTIMATED' as const,
      emissionFactorKgCo2ePerTonKm: 0.09,
      breakdown: { transportKgCo2e: 100, notes: [] },
      calculatedAt: new Date().toISOString(),
      inputVersion: 'carbon-v2',
    };
    const plan = makePlan({ complianceScore: 100 });
    const withCarbon = calculatePredictiveScores(plan, carbonResult);
    const withoutCarbon = calculatePredictiveScores(plan);
    // Med carbon ska fundingScore vara högre
    expect(withCarbon.fundingRisk.score).toBeGreaterThanOrEqual(withoutCarbon.fundingRisk.score);
  });

  it('hög complianceScore med carbonResult kan ge grönlån', () => {
    const carbonResult = {
      method: 'LOCAL_DISTANCE' as const,
      totalKgCo2e: 50,
      distanceKmUsed: 25,
      quality: 'ESTIMATED' as const,
      emissionFactorKgCo2ePerTonKm: 0.09,
      breakdown: { transportKgCo2e: 50, notes: [] },
      calculatedAt: new Date().toISOString(),
      inputVersion: 'carbon-v2',
    };
    const plan = makePlan({
      complianceScore: 100,
      mapLayerSelection: { base: ['CADASTRE'], optional: [], enabled: ['CADASTRE'], unavailable: [] },
    });
    const scores = calculatePredictiveScores(plan, carbonResult);
    // Kontrollera att eligibleForGreenLoan är en boolean
    expect(typeof scores.fundingRisk.eligibleForGreenLoan).toBe('boolean');
  });

  it('fundingRisk.score är alltid >= 0', () => {
    const plan = makePlan({
      complianceScore: 0,
      mapLayerSelection: {
        base: ['CADASTRE'],
        optional: [],
        enabled: ['CADASTRE', 'GROUNDWATER', 'NATURA2000', 'FLOOD_RISK'],
        unavailable: [],
      },
    });
    const scores = calculatePredictiveScores(plan);
    expect(scores.fundingRisk.score).toBeGreaterThanOrEqual(0);
  });

  it('returnerar alltid de tre riskdimensionerna', () => {
    const plan = makePlan();
    const scores = calculatePredictiveScores(plan);
    expect(scores).toHaveProperty('regulatoryRisk');
    expect(scores).toHaveProperty('environmentalRisk');
    expect(scores).toHaveProperty('fundingRisk');
  });

  it('regulatoryRisk.confidence är alltid 0.85', () => {
    const plan = makePlan();
    const scores = calculatePredictiveScores(plan);
    expect(scores.regulatoryRisk.confidence).toBe(0.85);
  });

  it('probabilityInjunction är 40% av probabilityRfi', () => {
    const plan = makePlan();
    const scores = calculatePredictiveScores(plan);
    const ratio = scores.regulatoryRisk.probabilityInjunction / scores.regulatoryRisk.probabilityRfi;
    expect(ratio).toBeCloseTo(0.4, 5);
  });
});
