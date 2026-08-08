import { Pool } from "pg";
import {
  DEFAULT_SPATIAL_QUERY_BUDGET,
  buildSpatialEvidenceContentHash,
  type ISpatialProvider,
  type SpatialQueryBudget,
  type SpatialQueryRequest,
  type SpatialEvidenceArtifact,
  type LUPropertyContextArtifact,
} from "@miljobeslut/mps-lu";
import type { ArtifactReference } from "@miljobeslut/mps-compliance/artifacts/ArtifactContract";
import type { ArtifactRepositoryPort } from "../../mps-runtime/src/kernel/ExecutionKernel";
import { resolveLayerBinding } from "./SpatialLayerRegistry";

const SRID_SWEREF99TM = 3006;

const OPERATION = {
  algorithm: "spatial.dwithin_existence",
  engine: "PostGIS",
  engine_fingerprint: {
    postgis: "3.x",
    srid: String(SRID_SWEREF99TM),
  },
} as const;

/**
 * Production SpatialProvider: CAS property_ref → SWEREF geometry → bounded ST_DWithin.
 * Emits SpatialEvidenceArtifact with TV-S1 identity hashing. Fail-closed on budget.
 */
export class SpatialProviderPostGIS implements ISpatialProvider {
  private pool: Pool;

  constructor(
    connectionString: string,
    private readonly casRepo: ArtifactRepositoryPort,
  ) {
    this.pool = new Pool({ connectionString });
  }

  /**
   * property_ref critical path helper: WGS84 → SWEREF99 TM [northing, easting].
   */
  async wgs84ToSweref99(
    lat: number,
    lng: number,
  ): Promise<readonly [number, number]> {
    const res = await this.pool.query<{ n: number; e: number }>(
      `
      SELECT
        ST_Y(g) AS n,
        ST_X(g) AS e
      FROM ST_Transform(
        ST_SetSRID(ST_MakePoint($1::float8, $2::float8), 4326),
        ${SRID_SWEREF99TM}
      ) AS g
      `,
      [lng, lat],
    );
    const row = res.rows[0];
    if (!row) {
      throw new Error("REJECT_PROPERTY_LOOKUP: WGS84→SWEREF99 transform returned no row");
    }
    return [Number(row.n), Number(row.e)];
  }

  async query(request: SpatialQueryRequest): Promise<SpatialEvidenceArtifact[]> {
    const budget = this.resolveBudget(request);
    this.assertBudget(request, budget);

    const propertyArtifact = await this.casRepo.resolve<LUPropertyContextArtifact>(
      request.property_ref,
    );
    if (!propertyArtifact?.payload?.coordinates) {
      throw new Error(
        `REJECT_PROPERTY_LOOKUP: LU_PROPERTY_CONTEXT missing/invalid for ${request.property_ref.artifact_id}`,
      );
    }

    const [northing, easting] = propertyArtifact.payload.coordinates;
    const bufferDistance =
      request.buffer_distance_meters ?? Math.min(500, budget.max_distance_meters);

    if (bufferDistance > budget.max_distance_meters) {
      throw new Error(
        `REJECT_SPATIAL_BUDGET: buffer_distance_meters=${bufferDistance} > max_distance_meters=${budget.max_distance_meters}`,
      );
    }

    const evidence: SpatialEvidenceArtifact[] = [];
    const started = Date.now();

    for (const layer of request.layers) {
      if (Date.now() - started > budget.timeout_ms) {
        throw new Error(
          `REJECT_SPATIAL_BUDGET: timeout_ms=${budget.timeout_ms} exceeded`,
        );
      }
      if (!layer || typeof layer.name !== "string") {
        throw new Error(
          `REJECT_SPATIAL_REQUEST: malformed layer ${JSON.stringify(layer)}`,
        );
      }

      const binding = resolveLayerBinding(layer.name);
      const sql = `
        SELECT 1 AS hit
        FROM ${binding.table}
        WHERE ST_DWithin(
          ${binding.geom_column},
          ST_SetSRID(ST_MakePoint($1, $2), ${SRID_SWEREF99TM}),
          $3
        )
        LIMIT $4
      `;

      const res = await this.pool.query(sql, [
        easting,
        northing,
        bufferDistance,
        budget.max_features_per_layer,
      ]);

      if (res.rowCount && res.rowCount > 0) {
        if (res.rowCount > budget.max_features_per_layer) {
          throw new Error(
            `REJECT_SPATIAL_BUDGET: layer ${layer.name} exceeded max_features_per_layer`,
          );
        }
        evidence.push(
          await this.createEvidence({
            propertyRef: request.property_ref,
            layerName: layer.name,
            layerVersion: layer.version_hash,
            provider: binding.provider,
            bufferDistance,
            easting,
            northing,
            found: true,
          }),
        );
      }
    }

    return evidence;
  }

  private resolveBudget(request: SpatialQueryRequest): SpatialQueryBudget {
    return {
      ...DEFAULT_SPATIAL_QUERY_BUDGET,
      ...(request.budget ?? {}),
    };
  }

  private assertBudget(
    request: SpatialQueryRequest,
    budget: SpatialQueryBudget,
  ): void {
    if (request.layers.length === 0) {
      throw new Error("REJECT_SPATIAL_REQUEST: layers must be non-empty");
    }
    if (request.layers.length > budget.max_layers) {
      throw new Error(
        `REJECT_SPATIAL_BUDGET: layers=${request.layers.length} > max_layers=${budget.max_layers}`,
      );
    }
  }

  private async createEvidence(input: {
    propertyRef: ArtifactReference;
    layerName: string;
    layerVersion: string;
    provider: string;
    bufferDistance: number;
    easting: number;
    northing: number;
    found: boolean;
  }): Promise<SpatialEvidenceArtifact> {
    const retrievedAt = new Date().toISOString();
    const geometry = input.found
      ? {
          type: "Polygon" as const,
          coordinates: [
            [
              [input.easting - 0.001, input.northing - 0.001],
              [input.easting + 0.001, input.northing - 0.001],
              [input.easting + 0.001, input.northing + 0.001],
              [input.easting - 0.001, input.northing + 0.001],
              [input.easting - 0.001, input.northing - 0.001],
            ],
          ],
        }
      : null;

    const payload = {
      property_ref: input.propertyRef,
      srid: SRID_SWEREF99TM,
      operation: OPERATION,
      geometry,
      layer_ref: {
        layer_id: input.layerName,
        layer_version: input.layerVersion,
      },
      source_metadata: {
        provider: input.provider,
        dataset: input.layerName,
        dataset_version: input.layerVersion,
        retrieved_at: retrievedAt,
      },
      query_context: {
        // Correlation only — excluded from identity hash (SV-I06)
        query_id: `corr-${input.layerName}`,
        query_type: "SPATIAL_DWITHIN",
        parameters: {
          property_ref: input.propertyRef,
          search_distance_meters: input.bufferDistance,
        },
      },
    };

    const content_hash = buildSpatialEvidenceContentHash(payload);
    const artifact_id = `evidence-${input.layerName}-${content_hash.value.slice(0, 16)}`;

    // CAS/WORM: identity-stable re-query must not rewrite provenance wall-clock (SV-I06).
    try {
      const existing = await this.casRepo.resolve<SpatialEvidenceArtifact>({
        artifact_id,
        artifact_type: "SPATIAL_EVIDENCE",
      });
      if (existing?.content_hash?.value === content_hash.value) {
        return existing;
      }
    } catch {
      // not present — continue to first-write
    }

    const artifact: SpatialEvidenceArtifact = {
      artifact_id,
      artifact_type: "SPATIAL_EVIDENCE",
      content_hash,
      references: [input.propertyRef],
      payload,
    };

    await this.casRepo.put({
      artifact_id: artifact.artifact_id,
      content_hash: artifact.content_hash,
      body: artifact,
    });

    return artifact;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
