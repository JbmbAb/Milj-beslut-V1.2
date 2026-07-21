import { describe, expect, it } from 'vitest';
import { isSensitiveAreaFromMassGis } from '../../services/massSpatialSensitivity';
import type { MassGISAnalysis } from '../../src/types/mass';

function buildAnalysis(overrides: Partial<MassGISAnalysis> = {}): MassGISAnalysis {
  return {
    propertyDesignation: 'TEST 1:1',
    timestamp: new Date().toISOString(),
    centroid: { lat: 60.67, lng: 17.14 },
    siteConstraints: [],
    overallRiskScore: 28,
    logisticsSuitability: 'SUITABLE',
    warnings: [],
    reasoning: [],
    ...overrides,
  };
}

describe('massSpatialSensitivity', () => {
  it('flags high water proximity as sensitive', () => {
    const analysis = buildAnalysis({
      siteConstraints: [
        {
          code: 'WATER_PROXIMITY',
          label: 'Våtmark/vatten nära platsen',
          severity: 'HIGH',
        },
      ],
    });

    expect(isSensitiveAreaFromMassGis(analysis)).toBe(true);
  });

  it('flags high overall risk score as sensitive', () => {
    expect(isSensitiveAreaFromMassGis(buildAnalysis({ overallRiskScore: 78 }))).toBe(true);
  });

  it('returns false for baseline low-risk analysis', () => {
    expect(isSensitiveAreaFromMassGis(buildAnalysis())).toBe(false);
  });
});
