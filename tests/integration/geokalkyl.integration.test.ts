import { describe, expect, it } from 'vitest';
import { calculateGeoKalkyl } from '../../server/services/geoKalkylService';
import { describeIfDatabaseIntegration } from './integrationTestEnv';

describeIfDatabaseIntegration('SGI Geokalkyl Integration', () => {
  it('calculates cost for a valid pipeline geometry near Gävle Brynäs', async () => {
    // Construct a LineString that spans across Brynäs area
    const geometry = {
      type: 'LineString',
      coordinates: [
        [17.16, 60.67],
        [17.17, 60.68],
      ],
    };

    const result = await calculateGeoKalkyl({
      geometry,
      pipeDepth: 1.8,
      baseCost: 1250,
    });

    expect(result.lengthMeters).toBeGreaterThan(0);
    expect(result.baselineCost).toBeGreaterThan(0);
    expect(result.totalCost).toBeGreaterThan(0);
    expect(result.totalCost).toBeGreaterThanOrEqual(result.baselineCost);
    expect(result.segments.length).toBeGreaterThan(0);

    const firstSegment = result.segments[0];
    expect(firstSegment.lengthMeters).toBeGreaterThan(0);
    expect(firstSegment.soilType).toBeDefined();
    expect(['fast', 'mellanfast', 'svag']).toContain(firstSegment.groundType);
    expect(firstSegment.segmentCost).toBeGreaterThan(0);
    expect(firstSegment.totalComplexity).toBeGreaterThanOrEqual(0);
  });

  it('correctly defaults pipeDepth and baseCost if omitted', async () => {
    const geometry = {
      type: 'LineString',
      coordinates: [
        [17.165, 60.675],
        [17.168, 60.678],
      ],
    };

    const result = await calculateGeoKalkyl({ geometry });

    expect(result.lengthMeters).toBeGreaterThan(0);
    expect(result.baselineCost).toBe(result.lengthMeters * 1250);
  });
});
