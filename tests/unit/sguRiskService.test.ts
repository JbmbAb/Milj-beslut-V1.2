import { describe, expect, it, vi } from 'vitest';

vi.mock('../../server/db/prisma', () => ({
  prisma: { $queryRaw: vi.fn(async () => []) },
}));

import {
  toGeologicalData,
  SGU_LANDSLIDE_REVIEW_BUFFER_METERS,
} from '../../server/services/sguRiskService';
import type { SguRiskAudit } from '../../server/services/sguRiskService';

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
