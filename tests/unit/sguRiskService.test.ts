import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Prisma mock ─────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  queryRaw: vi.fn(),
}));

vi.mock('../../server/db/prisma', () => ({
  prisma: {
    $queryRaw: mocks.queryRaw,
  },
}));

import {
  SGU_LANDSLIDE_REVIEW_BUFFER_METERS,
  auditSguRiskAtPoint,
  toGeologicalData,
  type SguRiskAudit,
} from '../../server/services/sguRiskService';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeAudit(overrides: Partial<SguRiskAudit> = {}): SguRiskAudit {
  return {
    coverageMode: 'complete',
    manualReviewRequired: false,
    riskLevel: 'LOW',
    groundLayer: {
      intersects: false,
      hit: null,
      advisory: 'Ingen träff.',
    },
    landslideFeatures: {
      nearby: false,
      bufferMeters: SGU_LANDSLIDE_REVIEW_BUFFER_METERS,
      nearestDistanceMeters: null,
      hits: [],
      advisory: 'Ingen träff.',
    },
    flags: [],
    summary: 'Ingen restriktion.',
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('sguRiskService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.SGU_DB_COVERAGE_MODE;
  });

  // ── constant ──────────────────────────────────────────────────────────────

  describe('SGU_LANDSLIDE_REVIEW_BUFFER_METERS', () => {
    it('is a positive number', () => {
      expect(SGU_LANDSLIDE_REVIEW_BUFFER_METERS).toBeGreaterThan(0);
    });
  });

  // ── auditSguRiskAtPoint ────────────────────────────────────────────────────

  describe('auditSguRiskAtPoint', () => {
    it('returns LOW risk when no features found', async () => {
      mocks.queryRaw.mockResolvedValueOnce([]); // ground layer
      mocks.queryRaw.mockResolvedValueOnce([]); // landslide features

      const result = await auditSguRiskAtPoint(59.32, 18.06);

      expect(result.riskLevel).toBe('LOW');
      expect(result.groundLayer.intersects).toBe(false);
      expect(result.landslideFeatures.nearby).toBe(false);
    });

    it('includes ground layer when found', async () => {
      const mockGroundLayer = [{
        source_key: 'sgu_jord_1m',
        layer_code: 123,
        layer_label: 'Morän',
        map_type: 1,
        source_scale: '1:1 000 000',
      }];
      mocks.queryRaw.mockResolvedValueOnce(mockGroundLayer);
      mocks.queryRaw.mockResolvedValueOnce([]);

      const result = await auditSguRiskAtPoint(59.32, 18.06);

      expect(result.groundLayer.intersects).toBe(true);
      expect(result.groundLayer.hit?.layerLabel).toBe('Morän');
      expect(result.groundLayer.hit?.sourceScale).toBe('1:1 000 000');
    });

    it('returns MEDIUM risk for landslide features with skredväg', async () => {
      mocks.queryRaw.mockResolvedValueOnce([]);
      const mockLandslide = [{
        source_key: 'sgu_skred',
        feature_code: 456,
        feature_label: 'Skredväg',
        distance_meters: 75,
      }];
      mocks.queryRaw.mockResolvedValueOnce(mockLandslide);

      const result = await auditSguRiskAtPoint(59.32, 18.06);

      expect(result.riskLevel).toBe('MEDIUM');
      expect(result.landslideFeatures.nearby).toBe(true);
    });

    it('returns HIGH risk for nearby landslide within 50m containing skred', async () => {
      mocks.queryRaw.mockResolvedValueOnce([]);
      const mockLandslide = [{
        source_key: 'sgu_skred',
        feature_code: 789,
        feature_label: 'Skredärr',
        distance_meters: 30,
      }];
      mocks.queryRaw.mockResolvedValueOnce(mockLandslide);

      const result = await auditSguRiskAtPoint(59.32, 18.06);

      expect(result.riskLevel).toBe('HIGH');
      expect(result.landslideFeatures.nearestDistanceMeters).toBe(30);
    });

    it('uses complete coverage mode when env variable is set', async () => {
      process.env.SGU_DB_COVERAGE_MODE = 'complete';
      mocks.queryRaw.mockResolvedValueOnce([]);
      mocks.queryRaw.mockResolvedValueOnce([]);

      const result = await auditSguRiskAtPoint(59.32, 18.06);

      expect(result.coverageMode).toBe('complete');
      expect(result.summary).not.toContain('stickprovsimport');
    });

    it('defaults to sample coverage mode', async () => {
      mocks.queryRaw.mockResolvedValueOnce([]);
      mocks.queryRaw.mockResolvedValueOnce([]);

      const result = await auditSguRiskAtPoint(59.32, 18.06);

      expect(result.coverageMode).toBe('sample');
      expect(result.summary).toContain('stickprovsimport');
    });

    it('includes flags for ground layer and landslide features', async () => {
      const mockGroundLayer = [{
        source_key: 'sgu_jord',
        layer_code: 1,
        layer_label: 'Lera',
        map_type: 1,
        source_scale: '1:50 000',
      }];
      const mockLandslide = [{
        source_key: 'sgu_skred',
        feature_code: 2,
        feature_label: 'Ravin',
        distance_meters: 120,
      }];
      mocks.queryRaw.mockResolvedValueOnce(mockGroundLayer);
      mocks.queryRaw.mockResolvedValueOnce(mockLandslide);

      const result = await auditSguRiskAtPoint(59.32, 18.06);

      expect(result.flags).toContain('grundlager:Lera');
      expect(result.flags.some(f => f.includes('ravin'))).toBe(true);
    });

    it('requires manual review in sample mode even with no hits', async () => {
      delete process.env.SGU_DB_COVERAGE_MODE;
      mocks.queryRaw.mockResolvedValueOnce([]);
      mocks.queryRaw.mockResolvedValueOnce([]);

      const result = await auditSguRiskAtPoint(59.32, 18.06);

      expect(result.manualReviewRequired).toBe(true);
      expect(result.coverageMode).toBe('sample');
    });

    it('requires manual review when landslide features found', async () => {
      process.env.SGU_DB_COVERAGE_MODE = 'complete';
      mocks.queryRaw.mockResolvedValueOnce([]);
      const mockLandslide = [{
        source_key: 'sgu',
        feature_code: 1,
        feature_label: 'Test',
        distance_meters: 100,
      }];
      mocks.queryRaw.mockResolvedValueOnce(mockLandslide);

      const result = await auditSguRiskAtPoint(59.32, 18.06);

      expect(result.manualReviewRequired).toBe(true);
    });

    it('handles null values in database results', async () => {
      const mockGroundLayer = [{
        source_key: 'test',
        layer_code: null,
        layer_label: null,
        map_type: null,
        source_scale: '1:1 000 000',
      }];
      mocks.queryRaw.mockResolvedValueOnce(mockGroundLayer);
      mocks.queryRaw.mockResolvedValueOnce([]);

      const result = await auditSguRiskAtPoint(59.32, 18.06);

      expect(result.groundLayer.hit?.layerCode).toBeNull();
      expect(result.groundLayer.hit?.layerLabel).toBeNull();
    });

    it('returns summary combining all advisories', async () => {
      mocks.queryRaw.mockResolvedValueOnce([]);
      mocks.queryRaw.mockResolvedValueOnce([]);

      const result = await auditSguRiskAtPoint(59.32, 18.06);

      expect(result.summary).toBeTruthy();
      expect(typeof result.summary).toBe('string');
    });
  });

  // ── toGeologicalData ──────────────────────────────────────────────────────

  describe('toGeologicalData', () => {
    it('maps a clean audit to GeologicalData', () => {
      const geo = toGeologicalData(makeAudit());

      expect(geo.soilType).toBe('Okänd');
      expect(geo.landslideFeatureHits).toHaveLength(0);
      expect(geo.landslideRiskLevel).toBe('NONE');
      expect(geo.manualReviewRequired).toBe(false);
      expect(geo.coverageMode).toBe('complete');
    });

    it('maps groundLayer hit to soilType and scale', () => {
      const audit = makeAudit({
        groundLayer: {
          intersects: true,
          hit: {
            sourceKey: 'src-1',
            layerCode: 10,
            layerLabel: 'Morän',
            mapType: 1,
            sourceScale: '1:250 000',
          },
          advisory: 'Träff.',
        },
      });

      const geo = toGeologicalData(audit);

      expect(geo.soilType).toBe('Morän');
      expect(geo.groundLayerScale).toBe('1:250 000');
    });

    it('maps HIGH riskLevel to "HIGH"', () => {
      const geo = toGeologicalData(makeAudit({ riskLevel: 'HIGH' }));
      expect(geo.landslideRiskLevel).toBe('HIGH');
    });

    it('maps MEDIUM riskLevel to "ADVISORY"', () => {
      const geo = toGeologicalData(makeAudit({ riskLevel: 'MEDIUM' }));
      expect(geo.landslideRiskLevel).toBe('ADVISORY');
    });

    it('maps LOW riskLevel to "NONE"', () => {
      const geo = toGeologicalData(makeAudit({ riskLevel: 'LOW' }));
      expect(geo.landslideRiskLevel).toBe('NONE');
    });

    it('includes landslide feature hits in output', () => {
      const audit = makeAudit({
        riskLevel: 'HIGH',
        manualReviewRequired: true,
        landslideFeatures: {
          nearby: true,
          bufferMeters: 150,
          nearestDistanceMeters: 45,
          hits: [
            {
              sourceKey: 'src-2',
              featureCode: 102,
              featureLabel: 'Skredbrant',
              distanceMeters: 45,
            },
          ],
          advisory: 'Träff inom 150 m.',
        },
      });

      const geo = toGeologicalData(audit);

      expect(geo.landslideFeatureHits).toHaveLength(1);
      expect(geo.landslideFeatureHits![0].featureLabel).toBe('Skredbrant');
      expect(geo.landslideFeatureHits![0].distanceMeters).toBe(45);
      expect(geo.manualReviewRequired).toBe(true);
    });

    it('uses "Okänt objekt" for null featureLabel', () => {
      const audit = makeAudit({
        landslideFeatures: {
          nearby: true,
          bufferMeters: 150,
          nearestDistanceMeters: 80,
          hits: [{ sourceKey: 'src-3', featureCode: null, featureLabel: null, distanceMeters: 80 }],
          advisory: 'Okänt objekt.',
        },
      });

      const geo = toGeologicalData(audit);
      expect(geo.landslideFeatureHits![0].featureLabel).toBe('Okänt objekt');
    });

    it('includes riskDescription from audit summary', () => {
      const audit = makeAudit({ summary: 'Sammanfattad risk: hög.' });
      expect(toGeologicalData(audit).riskDescription).toBe('Sammanfattad risk: hög.');
    });
  });
});
