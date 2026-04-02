import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loggerInfo: vi.fn(),
  loggerError: vi.fn(),
  loggerWarn: vi.fn(),
}));

vi.mock('../../server/logger', () => ({
  logger: {
    info: mocks.loggerInfo,
    error: mocks.loggerError,
    warn: mocks.loggerWarn,
  },
}));

import {
  computeBankComplianceProfile,
  getBankTaxonomyIndicators,
  scoreSingleIndicator,
  type ProjectComplianceData,
} from '../../legacy/experimental/bankComplianceProfileService';

const baseData: ProjectComplianceData = {
  projectId: 'proj-001',
  hasApprovedPermit: true,
  hasVerifiedAuditTrail: true,
  hasValidLimsReports: true,
  hasSignedDocuments: true,
  documentControlPassed: true,
  riskAssessmentPassed: true,
  gisRiskAnalysisDone: true,
  hasVerifiedTransportJournal: true,
  openRequirementsCount: 0,
  totalRequirementsCount: 10,
};

describe('bankComplianceProfileService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getBankTaxonomyIndicators', () => {
    it('returns a non-empty list', () => {
      const indicators = getBankTaxonomyIndicators();
      expect(indicators.length).toBeGreaterThan(0);
    });

    it('all indicators have id, category, maxScore', () => {
      for (const ind of getBankTaxonomyIndicators()) {
        expect(ind.id).toBeTruthy();
        expect(['ENVIRONMENTAL', 'SOCIAL', 'GOVERNANCE', 'LEGAL']).toContain(ind.category);
        expect(ind.maxScore).toBeGreaterThan(0);
      }
    });
  });

  describe('scoreSingleIndicator', () => {
    it('gives full score for ENV_PERMIT when permit exists', () => {
      const ind = getBankTaxonomyIndicators().find((i) => i.id === 'ENV_PERMIT')!;
      const result = scoreSingleIndicator(ind, baseData);
      expect(result.status).toBe('PASS');
      expect(result.score).toBe(ind.maxScore);
    });

    it('gives zero score for ENV_PERMIT when no permit', () => {
      const ind = getBankTaxonomyIndicators().find((i) => i.id === 'ENV_PERMIT')!;
      const result = scoreSingleIndicator(ind, { ...baseData, hasApprovedPermit: false });
      expect(result.status).toBe('FAIL');
      expect(result.score).toBe(0);
    });

    it('gives PARTIAL for ENV_LIMS when reports missing', () => {
      const ind = getBankTaxonomyIndicators().find((i) => i.id === 'ENV_LIMS')!;
      const result = scoreSingleIndicator(ind, { ...baseData, hasValidLimsReports: false });
      expect(result.status).toBe('PARTIAL');
      expect(result.score).toBeGreaterThan(0);
      expect(result.score).toBeLessThan(ind.maxScore);
    });

    it('gives PASS for GOV_AUDIT when audit trail verified', () => {
      const ind = getBankTaxonomyIndicators().find((i) => i.id === 'GOV_AUDIT')!;
      const result = scoreSingleIndicator(ind, baseData);
      expect(result.status).toBe('PASS');
      expect(result.score).toBe(ind.maxScore);
    });

    it('gives PARTIAL for GOV_AUDIT when trail unverified', () => {
      const ind = getBankTaxonomyIndicators().find((i) => i.id === 'GOV_AUDIT')!;
      const result = scoreSingleIndicator(ind, { ...baseData, hasVerifiedAuditTrail: false });
      expect(result.status).toBe('PARTIAL');
    });

    it('gives FAIL for GOV_REQUIREMENTS when less than 80% fulfilled', () => {
      const ind = getBankTaxonomyIndicators().find((i) => i.id === 'GOV_REQUIREMENTS')!;
      const result = scoreSingleIndicator(ind, {
        ...baseData,
        openRequirementsCount: 5,
        totalRequirementsCount: 10,
      });
      expect(result.status).toBe('FAIL');
    });

    it('gives PASS for GOV_REQUIREMENTS when all fulfilled', () => {
      const ind = getBankTaxonomyIndicators().find((i) => i.id === 'GOV_REQUIREMENTS')!;
      const result = scoreSingleIndicator(ind, baseData);
      expect(result.status).toBe('PASS');
      expect(result.score).toBe(ind.maxScore);
    });

    it('gives PARTIAL for GOV_SIGN when signed but gate not passed', () => {
      const ind = getBankTaxonomyIndicators().find((i) => i.id === 'GOV_SIGN')!;
      const result = scoreSingleIndicator(ind, {
        ...baseData,
        documentControlPassed: false,
      });
      expect(result.status).toBe('PARTIAL');
    });

    it('gives FAIL for GOV_SIGN when no signed documents', () => {
      const ind = getBankTaxonomyIndicators().find((i) => i.id === 'GOV_SIGN')!;
      const result = scoreSingleIndicator(ind, {
        ...baseData,
        hasSignedDocuments: false,
        documentControlPassed: false,
      });
      expect(result.status).toBe('FAIL');
    });
  });

  describe('computeBankComplianceProfile', () => {
    it('returns EXCELLENT rating for fully compliant project', () => {
      const profile = computeBankComplianceProfile(baseData);
      expect(profile.overallScore).toBe(100);
      expect(profile.ratingLabel).toBe('EXCELLENT');
      expect(profile.criticalGaps).toHaveLength(0);
      expect(profile.projectId).toBe('proj-001');
    });

    it('returns FAILING when multiple critical indicators fail', () => {
      const profile = computeBankComplianceProfile({
        ...baseData,
        hasApprovedPermit: false,
        hasVerifiedAuditTrail: false,
        hasSignedDocuments: false,
        documentControlPassed: false,
        gisRiskAnalysisDone: false,
        hasVerifiedTransportJournal: false,
        hasValidLimsReports: false,
        openRequirementsCount: 10,
        totalRequirementsCount: 10,
      });
      expect(profile.overallScore).toBeLessThan(35);
      expect(profile.ratingLabel).toBe('FAILING');
      expect(profile.criticalGaps.length).toBeGreaterThan(0);
    });

    it('includes computedAt timestamp', () => {
      const profile = computeBankComplianceProfile(baseData);
      expect(new Date(profile.computedAt).getTime()).not.toBeNaN();
    });

    it('includes categoryScores with pct values', () => {
      const profile = computeBankComplianceProfile(baseData);
      for (const cat of Object.values(profile.categoryScores)) {
        expect(cat.pct).toBeGreaterThanOrEqual(0);
        expect(cat.pct).toBeLessThanOrEqual(100);
      }
    });

    it('includes non-empty summary', () => {
      const profile = computeBankComplianceProfile(baseData);
      expect(profile.summary).toBeTruthy();
      expect(profile.summary).toContain(baseData.projectId);
    });

    it('logs info when computing', () => {
      computeBankComplianceProfile(baseData);
      expect(mocks.loggerInfo).toHaveBeenCalled();
    });

    it('score between 0 and 100 for partial compliance', () => {
      const profile = computeBankComplianceProfile({
        ...baseData,
        hasApprovedPermit: false,
        hasValidLimsReports: false,
      });
      expect(profile.overallScore).toBeGreaterThan(0);
      expect(profile.overallScore).toBeLessThan(100);
    });
  });
});
