import {
  Cartesian3,
  HeadingPitchRange,
  Math as CesiumMath,
  type Viewer,
  type DataSource,
  type Cesium3DTileset,
} from 'cesium';

export const SWEDEN_OVERVIEW = {
  lng: 15.0,
  lat: 62.0,
  heightMeters: 1_500_000,
} as const;

export type Wgs84ViewportBounds = {
  readonly west: number;
  readonly south: number;
  readonly east: number;
  readonly north: number;
};

export function flyToSwedenOverview(viewer: Viewer, duration = 1.6): void {
  viewer.camera.flyTo({
    destination: Cartesian3.fromDegrees(
      SWEDEN_OVERVIEW.lng,
      SWEDEN_OVERVIEW.lat,
      SWEDEN_OVERVIEW.heightMeters,
    ),
    duration,
  });
}

export function setSwedenOverviewInstant(viewer: Viewer): void {
  viewer.camera.setView({
    destination: Cartesian3.fromDegrees(
      SWEDEN_OVERVIEW.lng,
      SWEDEN_OVERVIEW.lat,
      SWEDEN_OVERVIEW.heightMeters,
    ),
  });
}

export function flyToPropertyDataSource(viewer: Viewer, dataSource: DataSource, duration = 3.0): void {
  const offset = new HeadingPitchRange(
    CesiumMath.toRadians(0.0),
    CesiumMath.toRadians(-45.0),
    0.0,
  );
  void viewer.flyTo(dataSource, { duration, offset });
}

export function flyToLngLat(
  viewer: Viewer,
  lng: number,
  lat: number,
  heightMeters = 350,
  duration = 3.0,
): void {
  viewer.camera.flyTo({
    destination: Cartesian3.fromDegrees(lng, lat - 0.004, heightMeters),
    orientation: {
      heading: CesiumMath.toRadians(0.0),
      pitch: CesiumMath.toRadians(-45.0),
      roll: 0.0,
    },
    duration,
  });
}

export async function flyToTileset(
  viewer: Viewer,
  tileset: Cesium3DTileset,
  duration = 2.0,
): Promise<void> {
  await viewer.flyTo(tileset, { duration });
}

/**
 * Compute current camera rectangle in WGS84 degrees.
 * Presentation helper only — does not expand server query authority.
 */
export function getViewportBoundsWgs84(viewer: Viewer): Wgs84ViewportBounds | null {
  const rect = viewer.camera.computeViewRectangle(viewer.scene.globe.ellipsoid);
  if (!rect) return null;
  return {
    west: CesiumMath.toDegrees(rect.west),
    south: CesiumMath.toDegrees(rect.south),
    east: CesiumMath.toDegrees(rect.east),
    north: CesiumMath.toDegrees(rect.north),
  };
}

export function formatBboxQuery(bounds: Wgs84ViewportBounds): string {
  return `${bounds.west},${bounds.south},${bounds.east},${bounds.north}`;
}
