/**
 * Tests for root-level services/complianceRulesEngine.ts
 * (skiljer sig från server/services/complianceRuleEngine.ts)
 */
import { describe, it, expect } from 'vitest';
import { evaluateProjectCompliance } from '../../services/complianceRulesEngine';
import type { ComplianceMetrics } from '../../services/complianceRulesEngine';

const base: ComplianceMetrics = {
  volumeTons: 0,
  hazardousClassification: false,
  groundwaterProximity: false,
  missingDocumentation: false,
  labExceedancesCount: 0,
};

describe('evaluateProjectCompliance — tillstånds-/anmälningsplikt', () => {
  it('returnerar NONE för volym ≤ 10 ton utan farligt avfall', () => {
    const result = evaluateProjectCompliance({ ...base, volumeTons: 5 });
    expect(result.requiresPermitOrNotification).toBe('NONE');
    expect(result.requirements).toHaveLength(0);
  });

  it('returnerar NOTIFICATION för volym > 10 ton', () => {
    const result = evaluateProjectCompliance({ ...base, volumeTons: 11 });
    expect(result.requiresPermitOrNotification).toBe('NOTIFICATION');
    expect(result.requirements[0]).toContain('C-anläggning');
  });

  it('returnerar PERMIT för volym > 10 000 ton', () => {
    const result = evaluateProjectCompliance({ ...base, volumeTons: 15000 });
    expect(result.requiresPermitOrNotification).toBe('PERMIT');
    expect(result.requirements[0]).toContain('B-anläggning');
  });

  it('returnerar PERMIT vid farlig klassificering oavsett volym', () => {
    const result = evaluateProjectCompliance({ ...base, volumeTons: 1, hazardousClassification: true });
    expect(result.requiresPermitOrNotification).toBe('PERMIT');
  });

  it('inkluderar volym i NOTIFICATION-meddelande', () => {
    const result = evaluateProjectCompliance({ ...base, volumeTons: 500 });
    expect(result.requirements[0]).toContain('500');
  });
});

describe('evaluateProjectCompliance — riskpoäng och risknivå', () => {
  it('ger LOW risk utan riskfaktorer', () => {
    const result = evaluateProjectCompliance({ ...base, volumeTons: 5 });
    expect(result.riskScore).toBe('LOW');
    expect(result.riskFactors).toHaveLength(0);
  });

  it('ger MEDIUM vid grundvattennärhet (rawScore +3)', () => {
    const result = evaluateProjectCompliance({ ...base, groundwaterProximity: true });
    expect(result.riskScore).toBe('MEDIUM');
    expect(result.riskFactors).toContain(
      'Platsen ligger inom eller nära vattenskyddsområde/grundvattenmagasin.',
    );
  });

  it('ger MEDIUM vid saknad dokumentation (rawScore +2)', () => {
    const result = evaluateProjectCompliance({ ...base, missingDocumentation: true, volumeTons: 150 });
    // +2 doc + +1 vol(>100) = 3 → MEDIUM
    expect(result.riskScore).toBe('MEDIUM');
    expect(result.riskFactors).toContain('Saknar formell spårbarhetsdokumentation eller egenkontroll.');
  });

  it('ger MEDIUM vid farligt avfall ensamt (rawScore +5, tröskel HIGH = 7)', () => {
    const result = evaluateProjectCompliance({ ...base, hazardousClassification: true });
    // rawScore = 5 (hazardous) → ≥3 men <7 → MEDIUM
    expect(result.riskScore).toBe('MEDIUM');
    expect(result.riskFactors).toContain('Farligt avfall (HW) identifierat.');
  });

  it('ger HIGH vid farligt avfall + grundvatten (rawScore +5+3 = 8)', () => {
    const result = evaluateProjectCompliance({
      ...base,
      hazardousClassification: true,
      groundwaterProximity: true,
    });
    expect(result.riskScore).toBe('HIGH');
    expect(result.riskFactors).toContain('Farligt avfall (HW) identifierat.');
    expect(result.riskFactors).toContain(
      'Platsen ligger inom eller nära vattenskyddsområde/grundvattenmagasin.',
    );
  });

  it('ger HIGH vid laböverskridanden (rawScore +4 ≥ 7 med annan faktor)', () => {
    const result = evaluateProjectCompliance({ ...base, labExceedancesCount: 2, groundwaterProximity: true });
    // +4 lab + +3 gw = 7 → HIGH
    expect(result.riskScore).toBe('HIGH');
    expect(result.riskFactors.some((f) => f.includes('2 parameter'))).toBe(true);
  });

  it('rapporterar korrekt antal laböverskridanden', () => {
    const result = evaluateProjectCompliance({ ...base, labExceedancesCount: 5 });
    expect(result.riskFactors.some((f) => f.includes('5 parameter'))).toBe(true);
  });

  it('volym > 100 ger +1 riskpoäng', () => {
    // +1 (vol>100) + +2 (missingDoc) = 3 → MEDIUM
    const result = evaluateProjectCompliance({ ...base, volumeTons: 101, missingDocumentation: true });
    expect(result.riskScore).toBe('MEDIUM');
  });

  it('volym > 1000 ger +2 riskpoäng', () => {
    // +2 (vol>1000) = 2 → LOW (behöver ytterligare faktor för MEDIUM)
    const r1 = evaluateProjectCompliance({ ...base, volumeTons: 1001 });
    expect(r1.riskScore).toBe('LOW');
    // +2 (vol) + +2 (missingDoc) = 4 → MEDIUM
    const r2 = evaluateProjectCompliance({ ...base, volumeTons: 1001, missingDocumentation: true });
    expect(r2.riskScore).toBe('MEDIUM');
  });

  it('volym > 50 000 ger +3 riskpoäng', () => {
    // +3 (vol>50000) = 3 → MEDIUM
    const result = evaluateProjectCompliance({ ...base, volumeTons: 60000 });
    expect(result.riskScore).toBe('MEDIUM');
  });

  it('kombination av alla faktorer ger HIGH', () => {
    const result = evaluateProjectCompliance({
      volumeTons: 60000,
      hazardousClassification: true,
      groundwaterProximity: true,
      missingDocumentation: true,
      labExceedancesCount: 3,
    });
    expect(result.riskScore).toBe('HIGH');
    expect(result.riskFactors.length).toBeGreaterThanOrEqual(4);
  });

  it('gränsvärde rawScore = 6 ger MEDIUM, inte HIGH', () => {
    // +3 (gw) + +2 (doc) + +1 (vol>100) = 6 → MEDIUM
    const result = evaluateProjectCompliance({
      ...base,
      volumeTons: 200,
      groundwaterProximity: true,
      missingDocumentation: true,
    });
    expect(result.riskScore).toBe('MEDIUM');
  });

  it('gränsvärde rawScore = 7 ger HIGH', () => {
    // +4 (lab) + +3 (gw) = 7 → HIGH
    const result = evaluateProjectCompliance({
      ...base,
      labExceedancesCount: 1,
      groundwaterProximity: true,
    });
    expect(result.riskScore).toBe('HIGH');
  });
});
