import type { ArtifactReference } from "@miljobeslut/mps-compliance/src/artifacts/ArtifactContract";

export interface CanonicalProjectGeometry {
  readonly type: "Polygon" | "MultiPolygon";
  readonly coordinates: unknown;
}

/**
 * Verified canonical project/property context.
 * Field set matches the historical product resolver result exactly.
 */
export interface CanonicalProjectContext {
  readonly projectContextRef: ArtifactReference;
  readonly propertyContextRef: ArtifactReference;
  readonly contextBindingRef: ArtifactReference;
  readonly geometryRef: ArtifactReference;
  readonly propertyDesignation: string;
  /** Canonical site identity — ExecutionIdentity site_id must come from here. */
  readonly propertyIdentity: string;
  readonly municipality: string;
  readonly coordinates: readonly [number, number];
  readonly geometry: CanonicalProjectGeometry;
}
