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
