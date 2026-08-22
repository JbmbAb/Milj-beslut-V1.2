import proj4 from "proj4";
import type { CanonicalGeometry } from "../domain/CanonicalGeometry.js";

/**
 * LU-CESIUM-GEOJSON-CRS-COMPATIBILITY-01.
 *
 * The canonical evidence CRS (whatever `SpatialEvidenceArtifact.payload.srid` declares, e.g.
 * SWEREF99 TM / EPSG:3006) is NOT the same thing as the GeoJSON transport CRS a consumer like
 * Cesium's `GeoJsonDataSource` actually accepts. RFC 7946 GeoJSON has no `crs` member at all --
 * coordinates are always WGS84 (EPSG:4326) by specification -- and Cesium's loader only
 * recognizes a small fixed allowlist of legacy `crs` names, rejecting anything else outright
 * (including a technically-valid `urn:ogc:def:crs:EPSG::3006`).
 *
 * This module transforms presentation coordinates to WGS84 so the transport is always spec-
 * compliant; the source SRID is preserved separately as feature-property provenance, never
 * silently dropped and never falsified as though the evidence were captured in 4326.
 */
const SWEREF99TM_PROJ4_DEF =
  "+proj=tmerc +lat_0=0 +lon_0=15 +k=0.9996 +x_0=500000 +y_0=0 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs";
const WGS84_SRID = 4326;
const SWEREF99TM_SRID = 3006;

function transformCoordinatePair(pair: readonly number[], fromDef: string): number[] {
  const [x, y] = pair;
  const [lng, lat] = proj4(fromDef, "EPSG:4326", [x, y]);
  return [lng, lat];
}

/** Recurses through GeoJSON coordinate nesting (Point through MultiPolygon) transforming every leaf [x, y] pair. */
function transformCoordinates(coordinates: unknown, fromDef: string): unknown {
  if (!Array.isArray(coordinates)) {
    throw new Error(`REJECT_GEOJSON_COORDINATE_TRANSFORM: expected an array, got ${typeof coordinates}`);
  }
  if (typeof coordinates[0] === "number") {
    return transformCoordinatePair(coordinates as readonly number[], fromDef);
  }
  return coordinates.map((child) => transformCoordinates(child, fromDef));
}

/**
 * Transforms `geometry` from `srid` to WGS84 for GeoJSON transport. `null` passes through
 * unchanged (nothing to project). A geometry already in WGS84 (`srid === 4326`) passes through
 * unchanged too -- no accidental double-transform. Any other SRID this function does not have a
 * known, exact projection for is a REJECT, not a best-effort guess: presenting mis-projected
 * coordinates as though they were correct is worse than refusing to render them.
 */
export function transformGeometryToWgs84(
  geometry: CanonicalGeometry | null,
  srid: number,
): CanonicalGeometry | null {
  if (geometry === null) return null;
  if (srid === WGS84_SRID) return geometry;
  if (srid === SWEREF99TM_SRID) {
    return {
      type: geometry.type,
      coordinates: transformCoordinates(geometry.coordinates, SWEREF99TM_PROJ4_DEF) as CanonicalGeometry["coordinates"],
    };
  }
  throw new Error(`REJECT_GEOJSON_COORDINATE_TRANSFORM: no known WGS84 projection for SRID ${srid}`);
}
