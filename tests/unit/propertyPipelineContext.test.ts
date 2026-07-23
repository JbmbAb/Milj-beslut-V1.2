import { describe, expect, it } from 'vitest';
import { centroidFromGeoJson } from '../../server/modules/property/propertyPipelineContext';

describe('propertyPipelineContext', () => {
  it('computes centroid from MultiPolygon GeoJSON', () => {
    const geometry = {
      type: 'MultiPolygon',
      coordinates: [
        [
          [
            [17.1, 60.6],
            [17.2, 60.6],
            [17.2, 60.7],
            [17.1, 60.7],
            [17.1, 60.6],
          ],
        ],
      ],
    };
    const c = centroidFromGeoJson(geometry);
    expect(c).not.toBeNull();
    expect(c!.lng).toBeCloseTo(17.14, 1);
    expect(c!.lat).toBeCloseTo(60.64, 1);
  });

  it('computes centroid from Point', () => {
    const c = centroidFromGeoJson({ type: 'Point', coordinates: [18.0, 59.3] });
    expect(c).toEqual({ lng: 18.0, lat: 59.3 });
  });

  it('returns null for empty geometry', () => {
    expect(centroidFromGeoJson(null)).toBeNull();
    expect(centroidFromGeoJson({})).toBeNull();
  });
});
