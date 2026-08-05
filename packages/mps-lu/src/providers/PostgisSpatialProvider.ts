import { ISpatialProvider, SpatialQueryRequest } from "../services/SpatialQueryContract";
import { SpatialEvidenceArtifact } from "../artifacts/SpatialEvidenceArtifact";
import { ArtifactReference } from "@miljobeslut/mps-compliance/src/artifacts/ArtifactContract";
import { LUPropertyContextArtifact } from "../artifacts/LUPropertyContextArtifact";

/**
 * A generic query function that can execute raw SQL against PostGIS.
 */
export type PostgisQueryFunction = (sql: string, params: any[]) => Promise<any[]>;

/**
 * A generic loader function to retrieve artifacts by reference.
 */
export type ArtifactLoaderFunction = (ref: ArtifactReference) => Promise<any>;

/**
 * Maps logical layer names to their corresponding PostGIS tables.
 */
const LAYER_TABLE_MAP: Record<string, string> = {
  "water": "env.sgu_well_actual",
  "ebh": "env.ebh_potentiellt_fororenade_omraden",
  "protected_area": "env.natura2000_area",
};

/**
 * PostGIS implementation of ISpatialProvider for the LU Module.
 * Uses a dependency-injected query function to execute ST_DWithin
 * and an artifact loader to retrieve the property coordinates.
 */
export class PostgisSpatialProvider implements ISpatialProvider {
  constructor(
    private readonly queryFn: PostgisQueryFunction,
    private readonly artifactLoader: ArtifactLoaderFunction
  ) {}

  async query(request: SpatialQueryRequest): Promise<SpatialEvidenceArtifact[]> {
    const evidence: SpatialEvidenceArtifact[] = [];
    
    // 1. Resolve property coordinates via artifact loader
    const propertyArtifact = await this.artifactLoader(request.property_ref) as LUPropertyContextArtifact;
    
    if (!propertyArtifact || !propertyArtifact.payload || !propertyArtifact.payload.coordinates) {
      throw new Error(`Failed to load valid property context for ${request.property_ref.artifact_id}`);
    }

    const [lat, lng] = propertyArtifact.payload.coordinates; // Coordinates as [N, E] (SWEREF99 TM)

    // 2. Query each requested layer
    for (const layer of request.layers) {
      const tableName = LAYER_TABLE_MAP[layer];
      if (!tableName) {
        console.warn(`Layer ${layer} is not mapped to a PostGIS table. Skipping.`);
        continue;
      }

      // We use ST_DWithin with 500 meters search distance to match both points (wells) and polygons.
      const sql = `
        SELECT 1 
        FROM ${tableName} 
        WHERE ST_DWithin(geom, ST_SetSRID(ST_MakePoint($1, $2), 3006), 500) 
        LIMIT 1
      `;

      try {
        const results = await this.queryFn(sql, [lng, lat]);
        
        if (results && results.length > 0) {
          // Intersection found
          const evidenceArtifact: SpatialEvidenceArtifact = {
            artifact_id: `evidence-${layer}-${Date.now()}`,
            artifact_type: "SPATIAL_EVIDENCE",
            content_hash: { algorithm: "sha256", value: "generated-hash" }, // Placeholder for now
            references: [request.property_ref],
            payload: {
              property_ref: request.property_ref,
              geometry: { 
                type: "Polygon", 
                coordinates: [[
                  [lng - 0.001, lat - 0.001],
                  [lng + 0.001, lat - 0.001],
                  [lng + 0.001, lat + 0.001],
                  [lng - 0.001, lat + 0.001],
                  [lng - 0.001, lat - 0.001]
                ]]
              },
              layer_ref: { layer_id: layer, layer_version: "latest" },
              source_metadata: {
                provider: "PostGIS",
                dataset: layer,
                dataset_version: "latest",
                retrieved_at: new Date().toISOString()
              },
              query_context: {
                query_id: `query-${layer}-${Date.now()}`,
                query_type: "SPATIAL_INTERSECTION",
                parameters: {
                  property_ref: request.property_ref,
                  search_distance_meters: 0
                }
              }
            }
          };
          
          evidence.push(evidenceArtifact);
        }
      } catch (error) {
        console.error(`Error querying spatial layer ${layer}:`, error);
      }
    }

    return evidence;
  }
}
