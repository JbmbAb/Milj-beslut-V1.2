import { createHash } from "node:crypto";
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
  water: "env.sgu_well_actual",
  ebh: "env.ebh_potentiellt_fororenade_omraden",
  protected_area: "env.natura2000_area",
};

function deterministicId(parts: unknown[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 16);
}

/**
 * PostGIS implementation of ISpatialProvider for the LU Module.
 */
export class PostgisSpatialProvider implements ISpatialProvider {
  private readonly queryFn: PostgisQueryFunction;
  private readonly artifactLoader: ArtifactLoaderFunction;

  constructor(queryFn: PostgisQueryFunction, artifactLoader: ArtifactLoaderFunction) {
    this.queryFn = queryFn;
    this.artifactLoader = artifactLoader;
  }

  async query(request: SpatialQueryRequest): Promise<SpatialEvidenceArtifact[]> {
    const evidence: SpatialEvidenceArtifact[] = [];

    const propertyArtifact = (await this.artifactLoader(
      request.property_ref,
    )) as LUPropertyContextArtifact;

    if (
      !propertyArtifact ||
      !propertyArtifact.payload ||
      !propertyArtifact.payload.coordinates
    ) {
      throw new Error(
        `Failed to load valid property context for ${request.property_ref.artifact_id}`,
      );
    }

    const [lat, lng] = propertyArtifact.payload.coordinates;

    for (const layer of request.layers) {
      const tableName = LAYER_TABLE_MAP[layer];
      if (!tableName) {
        console.warn(`Layer ${layer} is not mapped to a PostGIS table. Skipping.`);
        continue;
      }

      const sql = `
        SELECT 1 
        FROM ${tableName} 
        WHERE ST_DWithin(geom, ST_SetSRID(ST_MakePoint($1, $2), 3006), 500) 
        LIMIT 1
      `;

      try {
        const results = await this.queryFn(sql, [lng, lat]);

        if (results && results.length > 0) {
          const idSuffix = deterministicId([
            request.property_ref.artifact_id,
            layer,
            lng,
            lat,
            500,
          ]);
          const content_hash = {
            algorithm: "sha256" as const,
            value: createHash("sha256")
              .update(
                JSON.stringify({
                  layer,
                  lng,
                  lat,
                  property: request.property_ref.artifact_id,
                }),
              )
              .digest("hex"),
          };
          evidence.push({
            artifact_id: `evidence-${layer}-${idSuffix}`,
            artifact_type: "SPATIAL_EVIDENCE",
            content_hash,
            references: [request.property_ref],
            payload: {
              property_ref: request.property_ref,
              geometry: {
                type: "Polygon",
                coordinates: [
                  [
                    [lng - 0.001, lat - 0.001],
                    [lng + 0.001, lat - 0.001],
                    [lng + 0.001, lat + 0.001],
                    [lng - 0.001, lat + 0.001],
                    [lng - 0.001, lat - 0.001],
                  ],
                ],
              },
              layer_ref: { layer_id: layer, layer_version: "latest" },
              source_metadata: {
                provider: "PostGIS",
                dataset: layer,
                dataset_version: "latest",
                retrieved_at: `seed:${idSuffix}`,
              },
              query_context: {
                query_id: `query-${layer}-${idSuffix}`,
                query_type: "SPATIAL_INTERSECTION",
                parameters: {
                  property_ref: request.property_ref,
                  search_distance_meters: 500,
                },
              },
            },
          });
        }
      } catch (error) {
        console.error(`Error querying spatial layer ${layer}:`, error);
      }
    }

    return evidence;
  }
}
