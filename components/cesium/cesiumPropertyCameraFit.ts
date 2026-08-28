/**
 * CESIUM-PROPERTY-CAMERA-FIT-01.
 *
 * Fit the camera from the selected property's own WGS84 GeoJSON — not Cesium DataSource
 * bounding spheres. Those spheres are centred inside the ellipsoid for surface polygons,
 * which sends flyTo underground: black globe, zero imagery tiles, until a manual Sweden reset.
 */
export const MIN_PROPERTY_CAMERA_HEIGHT_METERS = 400;
export const PROPERTY_EXTENT_HEIGHT_FACTOR = 2.4;
export const PROPERTY_BBOX_PADDING_RATIO = 0.35;

const WGS84_A = 6378137;
const WGS84_E2 = 0.00669437999014;
const METERS_PER_DEGREE_LAT = 111_320;

export type GeographicBbox = {
  readonly west: number;
  readonly east: number;
  readonly south: number;
  readonly north: number;
};

export type PropertyCameraDestination = {
  readonly longitude: number;
  readonly latitude: number;
  readonly heightMeters: number;
};

export type CartesianSphereDiagnosis = {
  readonly radiusMeters: number;
  readonly centerHeightMeters: number;
};

export type PropertyCameraFitOk = {
  readonly ok: true;
  readonly geometryTypes: readonly string[];
  readonly finiteCoordinateCount: number;
  readonly bbox: GeographicBbox;
  readonly destination: PropertyCameraDestination;
  readonly cartesianSphere: CartesianSphereDiagnosis;
  readonly classification: 'A_degenerate_cartesian_sphere' | 'D_valid_geometry_derived_destination';
};

export type PropertyCameraFitFail = {
  readonly ok: false;
  readonly reason: 'no-finite-wgs84-positions' | 'empty-geometry';
  readonly geometryTypes: readonly string[];
  readonly finiteCoordinateCount: number;
};

export type PropertyCameraFitResult = PropertyCameraFitOk | PropertyCameraFitFail;

export function isFiniteWgs84LonLat(longitude: number, latitude: number): boolean {
  return (
    Number.isFinite(longitude) &&
    Number.isFinite(latitude) &&
    longitude >= -180 &&
    longitude <= 180 &&
    latitude >= -90 &&
    latitude <= 90
  );
}

export function collectFiniteWgs84Positions(value: unknown, types: string[] = []): Array<{ lon: number; lat: number }> {
  const positions: Array<{ lon: number; lat: number }> = [];
  collect(value, types, positions);
  return positions;
}

function collect(value: unknown, types: string[], out: Array<{ lon: number; lat: number }>): void {
  if (!value || typeof value !== 'object') return;
  const record = value as { type?: unknown; coordinates?: unknown; geometry?: unknown; features?: unknown; geometries?: unknown };

  if (typeof record.type === 'string') {
    types.push(record.type);
  }

  if (Array.isArray(record.features)) {
    for (const feature of record.features) collect(feature, types, out);
    return;
  }
  if (record.geometry) {
    collect(record.geometry, types, out);
    return;
  }
  if (Array.isArray(record.geometries)) {
    for (const geometry of record.geometries) collect(geometry, types, out);
    return;
  }
  if (record.coordinates !== undefined) {
    collectCoordinateLeaves(record.coordinates, out);
  }
}

function collectCoordinateLeaves(coordinates: unknown, out: Array<{ lon: number; lat: number }>): void {
  if (!Array.isArray(coordinates) || coordinates.length === 0) return;
  if (typeof coordinates[0] === 'number') {
    const lon = coordinates[0];
    const lat = coordinates[1];
    if (typeof lon === 'number' && typeof lat === 'number' && isFiniteWgs84LonLat(lon, lat)) {
      out.push({ lon, lat });
    }
    return;
  }
  for (const child of coordinates) collectCoordinateLeaves(child, out);
}

function wgs84ToEcef(lonDeg: number, latDeg: number): { x: number; y: number; z: number } {
  const lon = (lonDeg * Math.PI) / 180;
  const lat = (latDeg * Math.PI) / 180;
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const n = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinLat * sinLat);
  return {
    x: n * cosLat * Math.cos(lon),
    y: n * cosLat * Math.sin(lon),
    z: n * (1 - WGS84_E2) * sinLat,
  };
}

function ecefToGeodeticHeight(x: number, y: number, z: number): number {
  const lon = Math.atan2(y, x);
  const p = Math.sqrt(x * x + y * y);
  let lat = Math.atan2(z, p * (1 - WGS84_E2));
  for (let i = 0; i < 6; i += 1) {
    const sinLat = Math.sin(lat);
    const n = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinLat * sinLat);
    lat = Math.atan2(z + WGS84_E2 * n * sinLat, p);
  }
  const sinLat = Math.sin(lat);
  const n = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinLat * sinLat);
  const height = p / Math.cos(lat) - n;
  void lon;
  return height;
}

function diagnoseCartesianSphere(positions: Array<{ lon: number; lat: number }>): CartesianSphereDiagnosis {
  const points = positions.map((p) => wgs84ToEcef(p.lon, p.lat));
  const center = points.reduce(
    (acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y, z: acc.z + p.z }),
    { x: 0, y: 0, z: 0 },
  );
  center.x /= points.length;
  center.y /= points.length;
  center.z /= points.length;
  let radius = 0;
  for (const p of points) {
    const dx = p.x - center.x;
    const dy = p.y - center.y;
    const dz = p.z - center.z;
    radius = Math.max(radius, Math.sqrt(dx * dx + dy * dy + dz * dz));
  }
  return {
    radiusMeters: radius,
    centerHeightMeters: ecefToGeodeticHeight(center.x, center.y, center.z),
  };
}

export function computePropertyCameraFit(geojson: unknown): PropertyCameraFitResult {
  const geometryTypes: string[] = [];
  const positions = collectFiniteWgs84Positions(geojson, geometryTypes);
  if (positions.length === 0) {
    return {
      ok: false,
      reason: geojson == null ? 'empty-geometry' : 'no-finite-wgs84-positions',
      geometryTypes,
      finiteCoordinateCount: 0,
    };
  }

  let west = positions[0].lon;
  let east = positions[0].lon;
  let south = positions[0].lat;
  let north = positions[0].lat;
  for (const p of positions) {
    west = Math.min(west, p.lon);
    east = Math.max(east, p.lon);
    south = Math.min(south, p.lat);
    north = Math.max(north, p.lat);
  }

  const padLng = Math.max((east - west) * PROPERTY_BBOX_PADDING_RATIO, 0);
  const padLat = Math.max((north - south) * PROPERTY_BBOX_PADDING_RATIO, 0);
  const bbox: GeographicBbox = {
    west: west - padLng,
    east: east + padLng,
    south: south - padLat,
    north: north + padLat,
  };

  const centerLng = (west + east) / 2;
  const centerLat = (south + north) / 2;
  const latMeters = Math.max(north - south, 1e-7) * METERS_PER_DEGREE_LAT;
  const lngMeters =
    Math.max(east - west, 1e-7) * METERS_PER_DEGREE_LAT * Math.cos((centerLat * Math.PI) / 180);
  const heightMeters = Math.max(
    MIN_PROPERTY_CAMERA_HEIGHT_METERS,
    Math.max(latMeters, lngMeters) * PROPERTY_EXTENT_HEIGHT_FACTOR,
  );

  const cartesianSphere = diagnoseCartesianSphere(positions);
  const classification =
    cartesianSphere.centerHeightMeters < 0
      ? 'A_degenerate_cartesian_sphere'
      : 'D_valid_geometry_derived_destination';

  if (
    !Number.isFinite(centerLng) ||
    !Number.isFinite(centerLat) ||
    !Number.isFinite(heightMeters) ||
    heightMeters <= 0
  ) {
    return {
      ok: false,
      reason: 'no-finite-wgs84-positions',
      geometryTypes,
      finiteCoordinateCount: positions.length,
    };
  }

  return {
    ok: true,
    geometryTypes,
    finiteCoordinateCount: positions.length,
    bbox,
    destination: {
      longitude: centerLng,
      latitude: centerLat,
      heightMeters,
    },
    cartesianSphere,
    classification,
  };
}
