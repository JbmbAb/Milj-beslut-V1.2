import { ISpatialProvider, SpatialQueryRequest } from "../services/SpatialQueryContract";
import {
  SpatialEvidenceArtifact,
  SpatialEvidencePayload,
} from "../artifacts/SpatialEvidenceArtifact";
import { buildSpatialEvidenceContentHash } from "../artifacts/SpatialEvidenceIdentity";
import { ArtifactReference } from "@miljobeslut/mps-compliance/src/artifacts/ArtifactContract";
import { LUPropertyContextArtifact } from "../artifacts/LUPropertyContextArtifact";
import { IArtifactRepository } from "../../../mps-runtime/src/kernel/IArtifactRepository";

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

/** SWEREF99 TM. Coordinates are metre-based easting/northing. */
const SRID_SWEREF99TM = 3006;

const SEARCH_DISTANCE_METERS = 500;

const OPERATION = {
  algorithm: "spatial.dwithin_existence",
  engine: "PostGIS",
  engine_fingerprint: {
    postgis: "3.4.2",
    geos: "3.12.1",
    proj: "9.3.1",
  }
} as const;

/**
 * PostGIS implementation of ISpatialProvider for the LU Module.
 */
export class PostgisSpatialProvider implements ISpatialProvider {
  private readonly queryFn: PostgisQueryFunction;
  private readonly artifactLoader: ArtifactLoaderFunction;
  private readonly repository: IArtifactRepository;

  constructor(
    queryFn: PostgisQueryFunction,
    artifactLoader: ArtifactLoaderFunction,
    repository: IArtifactRepository,
  ) {
    this.queryFn = queryFn;
    this.artifactLoader = artifactLoader;
    this.repository = repository;
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

    const [northing, easting] = propertyArtifact.payload.coordinates;

    for (const layer of request.layers) {
      if (!layer || typeof layer.name !== "string") {
        // A malformed request must fail loudly. Skipping it would report "no findings"
        // for a layer that was never queried.
        throw new Error(
          `Malformed spatial layer request: expected { name, version_hash }, received ${JSON.stringify(layer)}`,
        );
      }

      const tableName = LAYER_TABLE_MAP[layer.name];
      if (!tableName) {
        console.warn(`Layer ${layer.name} is not mapped to a PostGIS table. Skipping.`);
        continue;
      }

      const searchDistance = request.buffer_distance_meters ?? SEARCH_DISTANCE_METERS;

      const sql = `
        SELECT 1 
        FROM ${tableName} 
        WHERE ST_DWithin(geom, ST_SetSRID(ST_MakePoint($1, $2), ${SRID_SWEREF99TM}), ${searchDistance}) 
        LIMIT 1
      `;

      try {
        const results = await this.queryFn(sql, [easting, northing]);
        const found = results && results.length > 0;

        const payload: SpatialEvidencePayload = {
          property_ref: request.property_ref,
          srid: SRID_SWEREF99TM,
          operation: OPERATION,
          geometry: found ? {
            type: "Polygon",
            coordinates: [
              [
                [easting - 0.001, northing - 0.001],
                [easting + 0.001, northing - 0.001],
                [easting + 0.001, northing + 0.001],
                [easting - 0.001, northing + 0.001],
                [easting - 0.001, northing - 0.001],
              ],
            ],
          } : null,
          layer_ref: { layer_id: layer.name, layer_version: layer.version_hash },
          source_metadata: {
            provider: "PostGIS",
            dataset: layer.name,
            dataset_version: layer.version_hash,
            retrieved_at: new Date().toISOString(),
          },
          query_context: {
            query_id: `query-${layer.name}-${Date.now()}`,
            query_type: "SPATIAL_INTERSECTION",
            parameters: {
              property_ref: request.property_ref,
              search_distance_meters: searchDistance,
            },
          },
        };

        const content_hash = buildSpatialEvidenceContentHash(payload);
        const idSuffix = content_hash.value.slice(0, 16);

        const artifact: SpatialEvidenceArtifact = {
          artifact_id: `evidence-${layer.name}-${idSuffix}`,
          artifact_type: "SPATIAL_EVIDENCE",
          content_hash,
          references: [request.property_ref],
          payload,
        };

        // Write artifact to CAS repository to ensure replayability
        await this.repository.put({
          artifact_id: artifact.artifact_id,
          content_hash: artifact.content_hash,
          body: artifact,
        });

        evidence.push(artifact);
      } catch (error) {
        console.error(`Error querying spatial layer ${layer.name}:`, error);
        throw error;
      }
    }

    return evidence;
  }
}
