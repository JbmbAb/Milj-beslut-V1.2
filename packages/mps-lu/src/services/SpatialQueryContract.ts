import { ArtifactReference } from "@miljobeslut/mps-compliance/src/artifacts/ArtifactContract";
import { SpatialEvidenceArtifact } from "../artifacts/SpatialEvidenceArtifact";

/**
 * The MVP request passed from LU Application down to the Spatial Provider.
 * This ensures the spatial engine remains agnostic of LU business logic.
 */
export interface SpatialQueryRequest {
  readonly property_ref: ArtifactReference; // Points to the property context/geometry
  readonly layers: readonly string[]; // e.g. ["water", "protected_area", "ebh"]
}

/**
 * The interface that any Spatial Provider (e.g. PostGIS) must implement.
 */
export interface ISpatialProvider {
  /**
   * Executes a spatial query against the defined layers using the provided property geometry.
   * Returns an array of SpatialEvidenceArtifacts which become immutable observations.
   */
  query(request: SpatialQueryRequest): Promise<SpatialEvidenceArtifact[]>;
}
