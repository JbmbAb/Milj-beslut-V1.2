import { describe, expect, it } from 'vitest';
import {
  MIN_PROPERTY_CAMERA_HEIGHT_METERS,
  computePropertyCameraFit,
} from '../../components/cesium/cesiumPropertyCameraFit';

function squareAround(lon: number, lat: number, halfDeg: number) {
  return {
    type: 'Polygon',
    coordinates: [[
      [lon - halfDeg, lat - halfDeg],
      [lon + halfDeg, lat - halfDeg],
      [lon + halfDeg, lat + halfDeg],
      [lon - halfDeg, lat + halfDeg],
      [lon - halfDeg, lat - halfDeg],
    ]],
  };
}

describe('CESIUM-PROPERTY-CAMERA-FIT-01', () => {
  it('frames two geographically distinct cadastral polygons above the ellipsoid with finite volumes', () => {
    const south = computePropertyCameraFit(squareAround(13.2, 55.6, 0.001));
    const north = computePropertyCameraFit(squareAround(18.1, 67.85, 0.0015));

    expect(south.ok).toBe(true);
    expect(north.ok).toBe(true);
    if (!south.ok || !north.ok) return;

    for (const fit of [south, north]) {
      expect(fit.finiteCoordinateCount).toBeGreaterThan(3);
      expect(Number.isFinite(fit.bbox.west)).toBe(true);
      expect(fit.bbox.east).toBeGreaterThan(fit.bbox.west);
      expect(fit.bbox.north).toBeGreaterThan(fit.bbox.south);
      expect(fit.destination.heightMeters).toBeGreaterThan(0);
      expect(fit.destination.heightMeters).toBeGreaterThanOrEqual(MIN_PROPERTY_CAMERA_HEIGHT_METERS);
      expect(Number.isFinite(fit.destination.longitude)).toBe(true);
      expect(Number.isFinite(fit.destination.latitude)).toBe(true);
      expect(Number.isFinite(fit.destination.heightMeters)).toBe(true);
    }

    expect(south.destination.latitude).toBeLessThan(north.destination.latitude);
    expect(Math.abs(south.destination.longitude - north.destination.longitude)).toBeGreaterThan(1);
  });

  it('measures why DataSource cartesian-sphere fit is unusable: sphere center is below the ellipsoid', () => {
    const fit = computePropertyCameraFit(squareAround(14.7, 61.12, 0.0008));
    expect(fit.ok).toBe(true);
    if (!fit.ok) return;
    expect(fit.cartesianSphere.centerHeightMeters).toBeLessThan(0);
    expect(fit.classification).toBe('A_degenerate_cartesian_sphere');
    expect(fit.destination.heightMeters).toBeGreaterThan(0);
  });

  it('rejects non-WGS84 / empty geometry instead of inventing a camera volume', () => {
    expect(computePropertyCameraFit(null).ok).toBe(false);
    expect(
      computePropertyCameraFit({
        type: 'Point',
        coordinates: [330000, 6400000],
      }).ok,
    ).toBe(false);
    expect(computePropertyCameraFit({ type: 'Polygon', coordinates: [] }).ok).toBe(false);
  });
});
