import { ArtifactReference } from "@miljobeslut/mps-compliance/artifacts/ArtifactContract";

/**
 * UI Input Contract for creating a LU Project Context.
 * Note: The UI sends this request to the LU Application.
 * It is NOT an artifact, it is a request object.
 */
export interface LUProjectContextCreateRequest {
  readonly project_name: string;
  readonly description: string;
  readonly planned_activity?: string;
  readonly activity_category?: string;
  
  /** 
   * The UI must have verified the property geometry and obtained a reference 
   * to the canonical PropertyRef artifact. 
   */
  readonly property_refs: readonly ArtifactReference[];
  
  readonly created_by: string;
}

export class LUProjectContextService {
  // To be implemented: Takes a LUProjectContextCreateRequest, binds it to a release hash,
  // creates the LUProjectContextArtifact, and submits it to the Frozen Core.
}
