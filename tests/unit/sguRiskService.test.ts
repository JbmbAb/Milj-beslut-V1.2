import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  queryRaw: vi.fn(),
}));

vi.mock('../../server/db/prisma', () => ({
  prisma: {
    $queryRaw: mocks.queryRaw,
  },
}));

import {
  auditSguRiskAtPoint,
  toGeologicalData,
  SGU_LANDSLIDE_REVIEW_BUFFER_METERS,
} from '../../server/services/sguRiskService';

const GROUND_HIT = {
  source_key: 'sgu-mark',
  layer_code: 5,
  layer_label: 'Lera',
  map_type: 1,
  source_scale: '1:250 000',
};

const LANDSLIDE_HIT = {
  source_key: 'sgu-skred',
  feature_code: 10,
  feature_label: 'Skred',
  distance_meters: 45,
};

describe('SGU_LANDSLIDE_REVIEW_BUFFER_METERS', () => {
  it('is 150', () => {
    expect(SGU_LANDSLIDE_REVIEW_BUFFER_METERS).toBe(150);
  });
});

describe('auditSguRiskAtPoint', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    delete process.env.SGU_DB_COVERAGE_MODE;
  });

  it('returns LOW risk with no hits (sample mode)', async () => {
    mocks.queryRaw
      .mockResolvedValueOnce([]) // ground layer
      .mockResolvedValueOnce([]); // landslide features

    const result = await auditSguRiskAtPoint(59.33, 18.07);

    expect(result.riskLevel).toBe('LOW');
    expect(result.groundLayer.intersects).toBe(false);
    expect(result.groundLayer.hit).toBeNull();
    expect(result.landslideFeatures.nearby).toBe(false);
    expect(result.landslideFeatures.hits).toHaveLength(0);
    expect(result.coverageMode).toBe('sample');
    expect(result.manualReviewRequired).toBe(true);
    expect(result.flags).toContain('sgu:sample-coverage');
  });

  it('returns HIGH risk when landslide hit is within 50m with "skred" label', async () => {
    mocks.queryRaw
      .mockResolvedValueOnce([GROUND_HIT])
      .mockResolvedValueOnce([LANDSLIDE_HIT]); // distance_meters: 45, label: Skred

    const result = await auditSguRiskAtPoint(59.33, 18.07);

    expect(result.riskLevel).toBe('HIGH');
    expect(result.manualReviewRequired).toBe(true);
    expect(result.landslideFeatures.nearby).toBe(true);
    expect(result.landslideFeatures.nearestDistanceMeters).toBe(45);
    expect(result.groundLayer.intersects).toBe(true);
    expect(result.groundLayer.hit?.layerLabel).toBe('Lera');
  });

  it('returns MEDIUM risk for skredväg label beyond 50m', async () => {
    const mediumHit = { ...LANDSLIDE_HIT, feature_label: 'Skredväg', distance_meters: 80 };
    mocks.queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([mediumHit]);

    const result = await auditSguRiskAtPoint(59.33, 18.07);

    expect(result.riskLevel).toBe('MEDIUM');
  });

  it('includes grundlager flag when ground hit has a label', async () => {
    mocks.queryRaw
      .mockResolvedValueOnce([GROUND_HIT])
      .mockResolvedValueOnce([]);

    const result = await auditSguRiskAtPoint(59.33, 18.07);

    expect(result.flags).toContain('grundlager:Lera');
  });

  it('includes sgu landslide flags for each hit (max 3)', async () => {
    const hits = [
      { source_key: 'a', feature_code: 1, feature_label: 'Skred', distance_meters: 30 },
      { source_key: 'b', feature_code: 2, feature_label: 'Ravin', distance_meters: 70 },
      { source_key: 'c', feature_code: 3, feature_label: 'Skredärr', distance_meters: 100 },
      { source_key: 'd', feature_code: 4, feature_label: 'Extra', distance_meters: 140 },
    ];
    mocks.queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(hits);

    const result = await auditSguRiskAtPoint(59.33, 18.07);

    const sguFlags = result.flags.filter((f) => f.startsWith('sgu:'));
    expect(sguFlags).toHaveLength(3);
    expect(sguFlags[0]).toBe('sgu:skred:30m');
  });

  it('uses complete coverage mode from env variable', async () => {
    process.env.SGU_DB_COVERAGE_MODE = 'complete';
    mocks.queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const result = await auditSguRiskAtPoint(59.33, 18.07);

    expect(result.coverageMode).toBe('complete');
    expect(result.manualReviewRequired).toBe(false);
    expect(result.flags).not.toContain('sgu:sample-coverage');
  });

  it('advisory mentions missing data when no ground hit', async () => {
    mocks.queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const result = await auditSguRiskAtPoint(59.0, 18.0);

    expect(result.groundLayer.advisory).toContain('Ingen träff');
  });

  it('advisory mentions feature label and distance when landslide hit exists', async () => {
    mocks.queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([LANDSLIDE_HIT]);

    const result = await auditSguRiskAtPoint(59.0, 18.0);

    expect(result.landslideFeatures.advisory).toContain('45');
    expect(result.landslideFeatures.advisory).toContain('Skred');
  });

  it('bufferMeters matches constant', async () => {
    mocks.queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    const result = await auditSguRiskAtPoint(59.0, 18.0);

    expect(result.landslideFeatures.bufferMeters).toBe(SGU_LANDSLIDE_REVIEW_BUFFER_METERS);
  });
});

describe('toGeologicalData', () => {
  beforeEach(() => vi.resetAllMocks());

  it('maps HIGH audit to GeologicalData correctly', async () => {
    mocks.queryRaw
      .mockResolvedValueOnce([GROUND_HIT])
      .mockResolvedValueOnce([LANDSLIDE_HIT]);

    const audit = await auditSguRiskAtPoint(59.33, 18.07);
    const geo = toGeologicalData(audit);

    expect(geo.soilType).toBe('Lera');
    expect(geo.groundLayerScale).toBe('1:250 000');
    expect(geo.landslideRiskLevel).toBe('HIGH');
    expect(geo.manualReviewRequired).toBe(true);
    expect(geo.landslideFeatureHits).toHaveLength(1);
    expect(geo.landslideFeatureHits[0].featureLabel).toBe('Skred');
  });

  it('maps MEDIUM audit riskLevel to ADVISORY', async () => {
    const mediumHit = { ...LANDSLIDE_HIT, feature_label: 'Skredväg', distance_meters: 80 };
    mocks.queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([mediumHit]);

    const audit = await auditSguRiskAtPoint(59.0, 18.0);
    const geo = toGeologicalData(audit);

    expect(geo.landslideRiskLevel).toBe('ADVISORY');
  });

  it('maps LOW audit riskLevel to NONE', async () => {
    mocks.queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    process.env.SGU_DB_COVERAGE_MODE = 'complete';

    const audit = await auditSguRiskAtPoint(59.0, 18.0);
    const geo = toGeologicalData(audit);

    expect(geo.landslideRiskLevel).toBe('NONE');

    delete process.env.SGU_DB_COVERAGE_MODE;
  });

  it('uses fallback values when no ground hit', async () => {
    mocks.queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    const audit = await auditSguRiskAtPoint(59.0, 18.0);
    const geo = toGeologicalData(audit);

    expect(geo.soilType).toBe('Okänd');
    expect(geo.groundLayerScale).toBe('1:1 000 000');
  });

  it('uses "Okänt objekt" for hits with null featureLabel', async () => {
    const nullLabelHit = { ...LANDSLIDE_HIT, feature_label: null };
    mocks.queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([nullLabelHit]);

    const audit = await auditSguRiskAtPoint(59.0, 18.0);
    const geo = toGeologicalData(audit);

    expect(geo.landslideFeatureHits[0].featureLabel).toBe('Okänt objekt');
  });
});
