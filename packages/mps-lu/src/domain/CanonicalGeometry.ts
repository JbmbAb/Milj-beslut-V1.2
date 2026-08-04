export interface CanonicalGeometry {
  type: "Polygon" | "MultiPolygon";
  coordinates: readonly number[][][];
}
