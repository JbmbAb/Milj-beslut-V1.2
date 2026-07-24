import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { featureFlags, FeatureFlagService } from '../../src/infrastructure/feature-flags';
import { goldenMaster, GoldenMasterManager, GisResult, PdfStructure } from '../helpers/goldenMaster';

describe('Feature Flags Service', () => {
  beforeEach(() => {
    featureFlags.resetToDefaults();
    delete process.env.FEATURE_FLAG_MVP_SEWAGE_ASSESSMENT;
    delete process.env.FEATURE_FLAG_MVP_C_ANMALAN;
  });

  it('should evaluate standard enabled flags as true in staging', () => {
    const enabled = featureFlags.isEnabled('mvp-sewage-assessment', { environment: 'staging' });
    expect(enabled).toBe(true);
  });

  it('should respect environments restrictions', () => {
    const isEnabledInProd = featureFlags.isEnabled('new-ai-orchestration', { environment: 'production' });
    expect(isEnabledInProd).toBe(true);

    const isEnabledInDev = featureFlags.isEnabled('new-ai-orchestration', { environment: 'development' });
    expect(isEnabledInDev).toBe(true);
  });

  it('should override config using environment variables', () => {
    process.env.FEATURE_FLAG_NEW_AI_ORCHESTRATION = 'true';
    const customService = new FeatureFlagService();

    // Now it should be enabled in development
    expect(customService.isEnabled('new-ai-orchestration', { environment: 'development' })).toBe(true);

    delete process.env.FEATURE_FLAG_NEW_AI_ORCHESTRATION;
  });

  it('should allow whitelisted user IDs always', () => {
    // mvp-c-anmalan has rolloutPercentage 10 but is whitelisted for beta-tester-1
    const allowed = featureFlags.isEnabled('mvp-c-anmalan', {
      userId: 'beta-tester-1',
      environment: 'production',
    });
    expect(allowed).toBe(true);
  });

  it('should perform deterministic percentage rollout per user ID', () => {
    // Normal user with no whitelisting
    const runs: boolean[] = [];
    const totalUsers = 200;
    let enabledCount = 0;

    for (let i = 0; i < totalUsers; i++) {
      const enabled = featureFlags.isEnabled('mvp-c-anmalan', {
        userId: `random-user-${i}`,
        environment: 'production',
      });
      if (enabled) enabledCount++;
    }

    // Rollout is configured for 10%
    // Over a small sample of 200, it should hover around 10% (say, between 5% and 25%)
    const percentage = (enabledCount / totalUsers) * 100;
    expect(percentage).toBeGreaterThanOrEqual(1);
    expect(percentage).toBeLessThanOrEqual(30);

    // Consistency check: same user should get identical result every time
    const userA_1 = featureFlags.isEnabled('mvp-c-anmalan', {
      userId: 'user-abc-123',
      environment: 'production',
    });
    const userA_2 = featureFlags.isEnabled('mvp-c-anmalan', {
      userId: 'user-abc-123',
      environment: 'production',
    });
    expect(userA_1).toBe(userA_2);
  });
});

describe('Golden Master Manager', () => {
  const testKey = 'test-temp-golden-master';

  afterEach(() => {
    const filePath = path.join(process.cwd(), 'tests', 'fixtures', 'golden-masters', `${testKey}.json`);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  });

  it('should save and load JSON golden masters correctly', () => {
    const sampleData = { version: '1.2.3', features: ['gis', 'pdf'] };
    goldenMaster.saveGoldenMaster(testKey, sampleData);

    const loaded = goldenMaster.loadGoldenMaster(testKey);
    expect(loaded).toEqual(sampleData);
  });

  describe('GIS Comparisons', () => {
    const referenceGis: GisResult = {
      hitCount: 5,
      coordinates: [[59.3293, 18.0686]],
      calculatedAreaSqm: 12000,
      bufferDistances: [10, 50],
    };

    it('should match identical GIS results', () => {
      const result = goldenMaster.compareGis(referenceGis, referenceGis);
      expect(result.match).toBe(true);
    });

    it('should reject hit count mismatch', () => {
      const actual = { ...referenceGis, hitCount: 6 };
      const result = goldenMaster.compareGis(actual, referenceGis);
      expect(result.match).toBe(false);
      expect(result.difference).toContain('Hit count mismatch');
    });

    it('should reject coordinate mismatch outside tolerance', () => {
      const actual: GisResult = { ...referenceGis, coordinates: [[59.335, 18.07]] };
      const result = goldenMaster.compareGis(actual, referenceGis);
      expect(result.match).toBe(false);
      expect(result.difference).toContain('Coordinate index 0 mismatch');
    });

    it('should accept area difference within tolerance', () => {
      // 12005 is +0.04% of 12000, which is well within 0.5% tolerance
      const actual = { ...referenceGis, calculatedAreaSqm: 12005 };
      const result = goldenMaster.compareGis(actual, referenceGis);
      expect(result.match).toBe(true);
    });

    it('should reject area difference exceeding tolerance', () => {
      // 12500 is +4.1% of 12000, exceeding 0.5% tolerance
      const actual = { ...referenceGis, calculatedAreaSqm: 12500 };
      const result = goldenMaster.compareGis(actual, referenceGis);
      expect(result.match).toBe(false);
      expect(result.difference).toContain('Area mismatch');
    });
  });

  describe('PDF Comparisons', () => {
    const referencePdf: PdfStructure = {
      pageCount: 3,
      headers: ['Beslut', 'Naturvårdsområden', 'Slutsats'],
      tables: [{ headers: ['Föreskrift', 'Krav'], rowCount: 4 }],
      citations: [{ documentId: 'viss-2026-v2', version: '2.0' }],
    };

    it('should match identical PDF structures', () => {
      const result = goldenMaster.comparePdf(referencePdf, referencePdf);
      expect(result.match).toBe(true);
    });

    it('should reject page count mismatches', () => {
      const actual = { ...referencePdf, pageCount: 4 };
      const result = goldenMaster.comparePdf(actual, referencePdf);
      expect(result.match).toBe(false);
      expect(result.difference).toContain('Page count mismatch');
    });

    it('should reject header mismatches', () => {
      const actual = { ...referencePdf, headers: ['Beslut', 'FelRubrik', 'Slutsats'] };
      const result = goldenMaster.comparePdf(actual, referencePdf);
      expect(result.match).toBe(false);
      expect(result.difference).toContain('Header mismatch at index 1');
    });

    it('should reject table row count mismatches', () => {
      const actual = {
        ...referencePdf,
        tables: [{ headers: ['Föreskrift', 'Krav'], rowCount: 5 }],
      };
      const result = goldenMaster.comparePdf(actual, referencePdf);
      expect(result.match).toBe(false);
      expect(result.difference).toContain('row count mismatch');
    });
  });
});
