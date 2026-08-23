import type { Pool } from "pg";
import type { SpatialLayerBinding } from "./SpatialLayerRegistry";

/**
 * SPATIAL-DATASET-RUNTIME-BINDING-V1.
 *
 * `SpatialLayerRegistry.ts`'s `version_hash` is a compile-time CLAIM about which governed
 * dataset materialized a PostGIS table -- nothing previously checked that claim against what is
 * actually connected via `DATABASE_URL` at query time. Pointing `DATABASE_URL` at a different
 * Postgres instance with the same schema but different row content would silently produce
 * `SpatialEvidenceArtifact`s claiming the same `version_hash` while the underlying data (and
 * therefore `match_count_observed`/`content_hash`) differed -- undetected.
 *
 * This does not invent a new registry table. `PostgisImportBatch`
 * (prisma/schema.prisma) is already the real, governed runtime-side half of the identity chain
 * documented in docs/architecture/ADR-POSTGIS-ADMIT-V1.md
 * (`source_sha256 -> import manifest -> dataset/version hash -> PostGIS layer`): it already
 * records, per `(target_schema, target_table)`, the `content_bundle_sha256` of whatever was
 * actually promoted into that table by the sanctioned import path
 * (`scripts/import/import-librarian-manifest.ts`).
 *
 * This module is the missing runtime verifier: before a layer's PostGIS table is queried for
 * evidence, look up the latest SUCCESS `PostgisImportBatch` row for that exact table (queried
 * over the SAME connection pool used for the spatial query itself -- deliberately not a
 * separate DB client, so the check is against the actually-connected instance, not merely
 * "a" database matching `DATABASE_URL` in configuration) and require its
 * `content_bundle_sha256` to equal the registry's claimed `version_hash`. `row_count` is
 * available on the batch row but deliberately NOT part of this check -- it is diagnostic only
 * (two distinct datasets can share a row count and a last-materialized timestamp); the batch's
 * own governed content hash is the only authority value.
 *
 * Fails closed on: no SUCCESS batch row for the table at all (layer was never through the
 * governed import path, or the live DB has never seen a successful promote), or a SUCCESS row
 * whose hash does not equal the registry's claim. Both cases deny before any SQL query touches
 * the layer's data and before any `SpatialEvidenceArtifact` is minted.
 */
export class SpatialLayerRuntimeBindingError extends Error {
  constructor(
    public readonly code: "REJECT_SPATIAL_LAYER_RUNTIME_BINDING_MISSING" | "REJECT_SPATIAL_LAYER_RUNTIME_BINDING_MISMATCH",
    message: string,
  ) {
    super(message);
    this.name = "SpatialLayerRuntimeBindingError";
  }
}

interface PostgisImportBatchRow {
  readonly content_bundle_sha256: string;
  readonly dataset_version: string | null;
}

function splitSchemaAndTable(qualifiedTable: string): { readonly schema: string; readonly table: string } {
  const dotIndex = qualifiedTable.indexOf(".");
  if (dotIndex < 0) {
    throw new Error(`REJECT_SPATIAL_LAYER_RUNTIME_BINDING: table "${qualifiedTable}" is not schema-qualified`);
  }
  return { schema: qualifiedTable.slice(0, dotIndex), table: qualifiedTable.slice(dotIndex + 1) };
}

/**
 * Verifies the given layer binding's claimed `version_hash` against the latest SUCCESS
 * `PostgisImportBatch` row for that table, queried on `pool` -- the same connection the caller
 * is about to run the actual spatial query against. Throws `SpatialLayerRuntimeBindingError` and
 * mints nothing on any mismatch or absence; resolves silently on a match.
 */
export async function verifySpatialLayerRuntimeBinding(
  pool: Pool,
  binding: SpatialLayerBinding,
): Promise<void> {
  const { schema, table } = splitSchemaAndTable(binding.table);
  const result = await pool.query<PostgisImportBatchRow>(
    `
    SELECT content_bundle_sha256, dataset_version
    FROM "PostgisImportBatch"
    WHERE target_schema = $1 AND target_table = $2 AND status = 'SUCCESS'
    ORDER BY completed_at DESC NULLS LAST, imported_at DESC
    LIMIT 1
    `,
    [schema, table],
  );
  const row = result.rows[0];
  if (!row) {
    throw new SpatialLayerRuntimeBindingError(
      "REJECT_SPATIAL_LAYER_RUNTIME_BINDING_MISSING",
      `no SUCCESS PostgisImportBatch row for ${binding.table} -- layer "${binding.logical_name}" has never been through the governed import path on the connected database`,
    );
  }
  if (row.content_bundle_sha256 !== binding.version_hash) {
    throw new SpatialLayerRuntimeBindingError(
      "REJECT_SPATIAL_LAYER_RUNTIME_BINDING_MISMATCH",
      `PostgisImportBatch.content_bundle_sha256 for ${binding.table} ("${row.content_bundle_sha256}") does not match SpatialLayerRegistry.version_hash ("${binding.version_hash}") for layer "${binding.logical_name}" -- the connected database's materialized dataset does not match the governed dataset this layer claims to represent`,
    );
  }
}
