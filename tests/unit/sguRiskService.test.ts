import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../../server/db/prisma', () => ({
  prisma: { $queryRaw: vi.fn(async () => []) },
}));

import {
  toGeologicalData,
  auditSguRiskAtPoint,
  SGU_LANDSLIDE_REVIEW_BUFFER_METERS,
} from '../../server/services/sguRiskService';
import type { SguRiskAudit } from '../../server/services/sguRiskService';
import { prisma } from '../../server/db/prisma';

const mockQueryRaw = vi.mocked(prisma.$queryRaw);

beforeEach(() => {
  mockQueryRaw.mockReset();
  mockQueryRaw.mockResolvedValue([]);
  delete process.env.SGU_DB_COVERAGE_MODE;
});

const baseLowAudit: SguRiskAudit = {
  coverageMode: 'sample',
  manualReviewRequired: false,
  riskLevel: 'LOW',
  groundLayer: {
    intersects: false,
    hit: null,
    advisory: 'No hit',
  },
  landslideFeatures: {
    nearby: false,
    bufferMeters: SGU_LANDSLIDE_REVIEW_BUFFER_METERS,
    nearestDistanceMeters: null,
    hits: [],
    advisory: 'No hits',
  },
  flags: [],
  summary: 'Low risk area',
};

describe('SGU_LANDSLIDE_REVIEW_BUFFER_METERS', () => {
  it('is 150 meters', () => {
    expect(SGU_LANDSLIDE_REVIEW_BUFFER_METERS).toBe(150);
  });
});

describe('toGeologicalData', () => {
  it('returns correct structure for low-risk audit without ground layer hit', () => {
    const geo = toGeologicalData(baseLowAudit);
    expect(geo.soilType).toBe('Okänd');
    expect(geo.groundLayerScale).toBe('1:1 000 000');
    expect(geo.landslideFeatureHits).toHaveLength(0);
    expect(geo.landslideRiskLevel).toBe('NONE');
    expect(geo.manualReviewRequired).toBe(false);
    expect(geo.coverageMode).toBe('sample');
    expect(geo.riskDescription).toBe('Low risk area');
  });

  it('uses hit layerLabel and sourceScale when ground layer hit exists', () => {
    const audit: SguRiskAudit = {
      ...baseLowAudit,
      groundLayer: {
        intersects: true,
        hit: {
          sourceKey: 'sgu-grundlager',
          layerCode: 5,
          layerLabel: 'Morän',
          mapType: 1,
          sourceScale: '1:250 000',
        },
        advisory: 'Hit found',
      },
    };
    const geo = toGeologicalData(audit);
    expect(geo.soilType).toBe('Morän');
    expect(geo.groundLayerScale).toBe('1:250 000');
  });

  it('maps HIGH riskLevel to HIGH landslideRiskLevel', () => {
    const geo = toGeologicalData({ ...baseLowAudit, riskLevel: 'HIGH' });
    expect(geo.landslideRiskLevel).toBe('HIGH');
  });

  it('maps MEDIUM riskLevel to ADVISORY landslideRiskLevel', () => {
    const geo = toGeologicalData({ ...baseLowAudit, riskLevel: 'MEDIUM' });
    expect(geo.landslideRiskLevel).toBe('ADVISORY');
  });

  it('maps LOW riskLevel to NONE landslideRiskLevel', () => {
    const geo = toGeologicalData({ ...baseLowAudit, riskLevel: 'LOW' });
    expect(geo.landslideRiskLevel).toBe('NONE');
  });

  it('correctly maps landslide feature hits', () => {
    const audit: SguRiskAudit = {
      ...baseLowAudit,
      landslideFeatures: {
        nearby: true,
        bufferMeters: 150,
        nearestDistanceMeters: 87,
        hits: [
          {
            sourceKey: 'sgu-skred',
            featureCode: 101,
            featureLabel: 'Skredbenägen zon',
            distanceMeters: 87,
          },
          {
            sourceKey: 'sgu-skred',
            featureCode: null,
            featureLabel: null,
            distanceMeters: 143,
          },
        ],
        advisory: 'Nearby hits found',
      },
    };
    const geo = toGeologicalData(audit);
    expect(geo.landslideFeatureHits).toHaveLength(2);
    expect(geo.landslideFeatureHits[0].featureLabel).toBe('Skredbenägen zon');
    expect(geo.landslideFeatureHits[1].featureLabel).toBe('Okänt objekt');
    expect(geo.landslideFeatureHits[0].distanceMeters).toBe(87);
  });

  it('sets manualReviewRequired correctly', () => {
    const geo = toGeologicalData({ ...baseLowAudit, manualReviewRequired: true });
    expect(geo.manualReviewRequired).toBe(true);
  });

  it('preserves coverageMode', () => {
    const geo = toGeologicalData({ ...baseLowAudit, coverageMode: 'complete' });
    expect(geo.coverageMode).toBe('complete');
  });
});

describe('auditSguRiskAtPoint()', () => {
  it('returns a valid SguRiskAudit shape with no DB data', async () => {
    mockQueryRaw.mockResolvedValue([]);
    const result = await auditSguRiskAtPoint(59.33, 18.07);
    expect(result).toBeDefined();
    expect(result.coverageMode).toBe('sample');
    expect(result.riskLevel).toBe('LOW');
    expect(result.groundLayer.intersects).toBe(false);
    expect(result.groundLayer.hit).toBeNull();
    expect(result.landslideFeatures.nearby).toBe(false);
    expect(result.landslideFeatures.hits).toHaveLength(0);
  });

  it('sets manualReviewRequired=true in sample mode with no hits', async () => {
    mockQueryRaw.mockResolvedValue([]);
    const result = await auditSguRiskAtPoint(59.33, 18.07);
    // sample mode always requires manual review
    expect(result.manualReviewRequired).toBe(true);
  });

  it('sets coverageMode=complete when SGU_DB_COVERAGE_MODE=complete', async () => {
    process.env.SGU_DB_COVERAGE_MODE = 'complete';
    mockQueryRaw.mockResolvedValue([]);
    const result = await auditSguRiskAtPoint(59.33, 18.07);
    expect(result.coverageMode).toBe('complete');
    delete process.env.SGU_DB_COVERAGE_MODE;
  });

  it('maps ground layer row to hit', async () => {
    // First call = groundLayer query, second call = landslide query
    mockQueryRaw
      .mockResolvedValueOnce([
        {
          source_key: 'sgu-grundlager',
          layer_code: 5,
          layer_label: 'Morän',
          map_type: 1,
          source_scale: '1:250 000',
        },
      ])
      .mockResolvedValueOnce([]);

    const result = await auditSguRiskAtPoint(59.33, 18.07);
    expect(result.groundLayer.intersects).toBe(true);
    expect(result.groundLayer.hit?.layerLabel).toBe('Morän');
    expect(result.groundLayer.hit?.sourceScale).toBe('1:250 000');
    expect(result.flags).toContain('grundlager:Morän');
  });

  it('maps landslide rows to hits and flags', async () => {
    mockQueryRaw
      .mockResolvedValueOnce([]) // ground layer
      .mockResolvedValueOnce([
        {
          source_key: 'sgu-skred',
          feature_code: 101,
          feature_label: 'Skredbenägen zon',
          distance_meters: 120,
        },
      ]);

    const result = await auditSguRiskAtPoint(59.33, 18.07);
    expect(result.landslideFeatures.nearby).toBe(true);
    expect(result.landslideFeatures.hits).toHaveLength(1);
    expect(result.landslideFeatures.nearestDistanceMeters).toBe(120);
    expect(result.flags.some((f) => f.includes('sgu:'))).toBe(true);
  });

  it('derives HIGH risk for skred feature within 50m', async () => {
    mockQueryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          source_key: 'sgu-skred',
          feature_code: 201,
          feature_label: 'Skred',
          distance_meters: 30,
        },
      ]);

    const result = await auditSguRiskAtPoint(59.33, 18.07);
    expect(result.riskLevel).toBe('HIGH');
    expect(result.manualReviewRequired).toBe(true);
  });

  it('derives MEDIUM risk for skredväg feature', async () => {
    mockQueryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          source_key: 'sgu-skred',
          feature_code: 102,
          feature_label: 'Skredväg',
          distance_meters: 100,
        },
      ]);

    const result = await auditSguRiskAtPoint(59.33, 18.07);
    expect(result.riskLevel).toBe('MEDIUM');
  });

  it('adds sgu:sample-coverage flag in sample mode with no landslide hits', async () => {
    mockQueryRaw.mockResolvedValue([]);
    const result = await auditSguRiskAtPoint(59.33, 18.07);
    expect(result.flags).toContain('sgu:sample-coverage');
  });

  it('landslideFeatures.bufferMeters equals SGU_LANDSLIDE_REVIEW_BUFFER_METERS', async () => {
    mockQueryRaw.mockResolvedValue([]);
    const result = await auditSguRiskAtPoint(59.33, 18.07);
    expect(result.landslideFeatures.bufferMeters).toBe(SGU_LANDSLIDE_REVIEW_BUFFER_METERS);
  });

  it('summary contains advisory text', async () => {
    mockQueryRaw.mockResolvedValue([]);
    const result = await auditSguRiskAtPoint(59.33, 18.07);
    expect(result.summary.length).toBeGreaterThan(0);
  });

  it('manualReviewRequired=false in complete mode with no hits', async () => {
    process.env.SGU_DB_COVERAGE_MODE = 'complete';
    mockQueryRaw.mockResolvedValue([]);
    const result = await auditSguRiskAtPoint(59.33, 18.07);
    expect(result.manualReviewRequired).toBe(false);
    delete process.env.SGU_DB_COVERAGE_MODE;
  });
});
