import { createHash } from "node:crypto";
import type { ContentHash } from "../../mps-compliance/src/artifacts/ContentHash";
import { sha256ContentHash } from "../../mps-compliance/src/canonical/sha256Canonical";
import type { ArtifactRepositoryPort } from "../../mps-runtime/src/kernel/ExecutionKernel";
import {
  SPATIAL_STACK_V1,
  type SpatialEngineFingerprint,
} from "../../mps-lu/src/artifacts/SpatialEngineFingerprint";
import { committedRetentionDigestPrecondition } from "./RetentionDigestPrecondition";
import {
  currentRetainedRelationNaming,
  retainedRelationDigestLengths,
  retainedRelationNamingOf,
  retainedRelationNamings,
  retainedRelationTableName,
} from "./ProtectedRelationSpec";

/**
 * SPATIAL-DATASET-RETENTION-V1 -- U30-B, PRES-05 "retain before replace" (R1).
 *
 * The governed import path promotes a dataset version with `replace` = TRUNCATE + INSERT
 * (scripts/import/import-librarian-manifest.ts). Evidence minted against the OUTGOING version is
 * hash-bound to that version (`layer_ref.version_hash` = the batch's `content_bundle_sha256`, see
 * SpatialDatasetRuntimeBinding.ts), so replacing it must not make that version impossible to
 * re-materialise.
 *
 * R1 keeps the materialised rows of every bound version in a retained relation in the same
 * database (`lm_staging.<table>_<hash8>`, the staging table the version was promoted from, or a
 * CTAS copy of live when that is gone) and writes a content-addressed retention record to the
 * durable Mimers CAS: target, version hash, import batch, retained relation, column set and a
 * set digest over the rows. No new bytes go to CAS, only digest and metadata; no database
 * migration (the record id is deterministic in (target, version hash)).
 *
 * The gate (`retainOutgoingThenReplace`) runs BEFORE the TRUNCATE, under an ACCESS EXCLUSIVE
 * lock on the target, in the same transaction: the outgoing version must be retained, its
 * retained digest must equal the live digest, and its record must be written or verified in CAS
 * -- otherwise REJECT_PROMOTE_OUTGOING_VERSION_NOT_RETAINED and no TRUNCATE runs. There is no
 * override.
 *
 * Limits (stated, not hidden): the retained relation lives in the same database, so it is not a
 * backup and is protected only by code; the digest depends on the PostgreSQL/PostGIS stack (the
 * engine fingerprint is recorded, as asserted by SPATIAL_STACK_V1, not measured); `append`
 * promotes are out of scope. R2 (bytes in CAS) is a separate owner decision.
 *
 * U30F: records are contract v2 and carry their comparison basis (F3, `RetentionBasis`); a live
 * table with rows and no SUCCESS batch is never replaced (F5); every relation write here is one
 * of the governed doors of ProtectedRelationGate (F1).
 *
 * U30F2 M3: the retained relation's name is versioned (protected-relation-classification.v1.json
 * `relation_naming`): a NEW relation is `<table>_<first 24 hex>` (RETAINED_RELATION_NAME_V2_24HEX);
 * a relation made before that keeps its `<table>_<8 hex>` name (LEGACY_8HEX) and is found, used and
 * protected as it is -- never renamed. A version's relation is looked up under the current name
 * first, then the legacy one (`resolveRetainedRelation`). Record and claim state the scheme, and a
 * relation name that does not derive from the version's FULL content hash is refused.
 */

export const SPATIAL_DATASET_RETENTION_RECORD = "SPATIAL_DATASET_RETENTION_RECORD" as const;
/**
 * Legacy (b740615b..b6106193): records without a basis. Never read as verified; still a reason to
 * keep a relation (StagingCleanupProtection), since a record existed for it.
 */
export const SPATIAL_DATASET_RETENTION_CONTRACT_V1 = "spatial-dataset-retention-v1" as const;
/**
 * F3 (U30F): every record carries its comparison basis (`RetentionBasis`). A record exists only
 * when the retained relation was compared with the live table while the ledger's SUCCESS batch
 * identified the live version; there is no record without a basis and no "upgrade" of material
 * that cannot be compared (a superseded version without reference stays UNVERIFIED_BASIS, unrecorded).
 */
export const SPATIAL_DATASET_RETENTION_CONTRACT_V2 = "spatial-dataset-retention-v2" as const;
/**
 * Set digest over the materialised rows (multiset, order-independent, duplicate-sensitive):
 * row hash = sha256(to_jsonb(row of the sorted promote columns, cast to the live column types;
 *   geometry/geography as EWKB hex; timestamptz/timetz rendered in UTC)::text);
 * bucket   = first two hex chars of the row hash; bucket digest = sha256(row hashes sorted, "C");
 * digest   = sha256(join("\n", "<bucket>:<count>:<bucket digest>" sorted by bucket, "C")).
 */
export const MATERIALIZED_DIGEST_V1 = "pg-jsonb-row-sha256-set-v1" as const;
export const RETAINED_RELATION_SCHEMA = "lm_staging" as const;

export const REJECT_PROMOTE_OUTGOING_VERSION_NOT_RETAINED =
  "REJECT_PROMOTE_OUTGOING_VERSION_NOT_RETAINED" as const;
export const SPATIAL_DATASET_RETENTION_FAILED = "SPATIAL_DATASET_RETENTION_FAILED" as const;

export type SpatialDatasetRetentionFailureReason =
  | "INVALID_IDENTIFIER"
  | "OUTGOING_VERSION_CHANGED"
  /** F5: the live table holds rows but the ledger names no SUCCESS batch for it. */
  | "NO_SUCCESS_BATCH_FOR_LIVE_DATA"
  /** F3: the SUCCESS batch's recorded row count differs from the rows compared. */
  | "LEDGER_ROW_COUNT_MISMATCH"
  /** F4: the target is a digest-time precondition target that is unmeasured or over the lock budget. */
  | "DIGEST_TIME_PRECONDITION_UNMET"
  | "RETAINED_RELATION_MISSING"
  | "NO_COMMON_COLUMNS"
  | "DIGEST_MISMATCH"
  | "RECORD_CONFLICT"
  | "CAS_UNAVAILABLE"
  | "DATABASE_ERROR";

export class SpatialDatasetRetentionError extends Error {
  constructor(
    readonly code: typeof REJECT_PROMOTE_OUTGOING_VERSION_NOT_RETAINED | typeof SPATIAL_DATASET_RETENTION_FAILED,
    readonly reason: SpatialDatasetRetentionFailureReason,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(`${code} [${reason}]: ${message}`, options);
    this.name = "SpatialDatasetRetentionError";
  }
}

/** Minimal SQL port: a pg Pool/PoolClient or a Prisma (transaction) client adapter. */
export interface SqlPort {
  /** Row-returning statement. */
  query<T = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<{ rows: T[] }>;
  /** Statement without a result set (DDL, LOCK, TRUNCATE, INSERT). */
  execute(sql: string, params?: readonly unknown[]): Promise<void>;
}

export interface TransactionalSqlPort extends SqlPort {
  /** Runs `work` in one database transaction: commit on resolve, rollback on reject. */
  transaction<T>(work: (tx: SqlPort) => Promise<T>): Promise<T>;
}

export interface QualifiedTable {
  readonly schema: string;
  readonly table: string;
}

export interface ImportBatchRow {
  readonly id: string;
  readonly content_bundle_sha256: string;
  readonly dataset_version: string | null;
  /** The ledger's row count for the batch (SUCCESS: live rows after promote); null/absent = not recorded. */
  readonly row_count?: number | string | bigint | null;
}

export interface RelationColumn {
  readonly name: string;
  /** `format_type(atttypid, atttypmod)`, e.g. `character varying(254)`. */
  readonly type: string;
  /** `pg_type.typname`, e.g. `geometry`, `timestamptz`. */
  readonly typname: string;
}

export interface MaterializedDigest {
  readonly row_count: number;
  readonly digest: string;
}

/** Where the comparison that verified the record was made. */
export type RetentionBasisEstablishedBy =
  /** The gate, before TRUNCATE: the outgoing (current) version, live vs its retained relation. */
  | "REPLACE_OUTGOING"
  /** Right after a SUCCESS promote: the incoming version, live vs the staging relation it came from. */
  | "PROMOTE_INCOMING"
  /** The ops backfill: the CURRENT version only, live vs its retained relation. */
  | "BACKFILL_CURRENT";

export type RetainedRelationOrigin =
  /** The staging relation the version was promoted from (an independent materialisation of the bundle). */
  | "STAGING_IMPORT_PROMOTED_FROM"
  /** Copied from live by the gate's phase A: equal to live by construction; identity rests on the ledger. */
  | "CTAS_FROM_LIVE_AT_REPLACE"
  /** Present before this comparison; how it came to be is not known here. */
  | "PRE_EXISTING_RELATION";

/**
 * The comparison basis of a verified record (F3). It binds: the ledger SUCCESS batch that
 * identifies the version (`version_batch_id`, `version_hash`), the live relation and its digest at
 * the moment of comparison (equal to the retained digest, or no record is written), the ledger's
 * row count cross-check, and where the retained relation came from.
 */
export interface RetentionBasis {
  readonly kind: "LIVE_EQUALS_RETAINED";
  readonly established_by: RetentionBasisEstablishedBy;
  readonly version_batch_id: string;
  readonly version_hash: string;
  readonly live_relation: string;
  readonly live_digest: { readonly row_count: number; readonly value: string };
  /** The batch's ledger row_count (checked equal to the retained rows), or null when the ledger recorded none. */
  readonly ledger_row_count: number | null;
  readonly retained_relation_origin: RetainedRelationOrigin;
}

export interface SpatialDatasetRetentionPayload {
  readonly contract_version: typeof SPATIAL_DATASET_RETENTION_CONTRACT_V2;
  readonly target: QualifiedTable;
  /** = SpatialLayerRegistry version_hash for a bound layer. */
  readonly content_bundle_sha256: string;
  /** The SUCCESS batch that first recorded this version's retention. */
  readonly import_batch_id: string;
  readonly dataset_version_label: string | null;
  /** e.g. `lm_staging.sgu_well_2b4b514f8b18a1a614d9aeac` (current) or `lm_staging.sgu_well_2b4b514f` (legacy). */
  readonly retained_relation: string;
  /** U30F2 M3: the naming scheme under which `retained_relation` derives from `content_bundle_sha256`. */
  readonly retained_relation_naming: string;
  /** Sorted promote columns (live ∩ retained, without `id`). */
  readonly columns: readonly string[];
  /** Live column types the digest casts to. */
  readonly column_types: Readonly<Record<string, string>>;
  readonly row_count: number;
  readonly digest: { readonly algorithm: typeof MATERIALIZED_DIGEST_V1; readonly value: string };
  readonly engine_fingerprint: SpatialEngineFingerprint;
  readonly basis: RetentionBasis;
}

export interface SpatialDatasetRetentionRecord {
  readonly artifact_id: string;
  readonly artifact_type: typeof SPATIAL_DATASET_RETENTION_RECORD;
  readonly content_hash: ContentHash;
  readonly payload: SpatialDatasetRetentionPayload;
}

// ---------------------------------------------------------------------------------------------
// Identifiers
// ---------------------------------------------------------------------------------------------

const SQL_IDENTIFIER = /^[a-z_][a-z0-9_]*$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;
const PG_MAX_IDENTIFIER_LENGTH = 63;

function invalid(message: string): SpatialDatasetRetentionError {
  return new SpatialDatasetRetentionError(SPATIAL_DATASET_RETENTION_FAILED, "INVALID_IDENTIFIER", message);
}

function assertIdentifier(name: string, what: string): void {
  if (!SQL_IDENTIFIER.test(name) || name.length > PG_MAX_IDENTIFIER_LENGTH) {
    throw invalid(`${what} "${name}" is not a plain lower-case SQL identifier of at most ${PG_MAX_IDENTIFIER_LENGTH} characters`);
  }
}

function assertVersionHash(sha256: string): void {
  if (!SHA256_HEX.test(sha256)) {
    throw invalid(`version hash "${sha256}" is not a lower-case sha256 hex digest`);
  }
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function quoteTable(t: QualifiedTable): string {
  assertIdentifier(t.schema, "schema");
  assertIdentifier(t.table, "table");
  return `${quoteIdent(t.schema)}.${quoteIdent(t.table)}`;
}

export function formatQualifiedTable(t: QualifiedTable): string {
  return `${t.schema}.${t.table}`;
}

export function parseQualifiedTable(qualified: string): QualifiedTable {
  const dot = qualified.indexOf(".");
  if (dot <= 0 || dot !== qualified.lastIndexOf(".")) {
    throw invalid(`"${qualified}" is not a schema-qualified table`);
  }
  const t = { schema: qualified.slice(0, dot), table: qualified.slice(dot + 1) };
  assertIdentifier(t.schema, "schema");
  assertIdentifier(t.table, "table");
  return t;
}

/**
 * The relation a NEW version is staged and retained in: `lm_staging.<table>_<first 24 hex>` under the
 * current naming scheme (U30F2 M3). A name over 63 bytes is refused, never truncated.
 */
export function retainedRelationFor(target: QualifiedTable, sha256: string): QualifiedTable {
  assertIdentifier(target.table, "table");
  assertVersionHash(sha256);
  const relation = { schema: RETAINED_RELATION_SCHEMA, table: retainedRelationTableName(target.table, sha256, currentRetainedRelationNaming()) };
  assertIdentifier(relation.table, "retained relation");
  return relation;
}

export interface RetainedRelationCandidate {
  readonly relation: QualifiedTable;
  /** The naming scheme (RETAINED_RELATION_NAME_V2_24HEX, LEGACY_8HEX). */
  readonly scheme: string;
}

/** Every name a version's retained relation may have, the current scheme first, then the legacy ones. */
export function retainedRelationCandidatesFor(target: QualifiedTable, sha256: string): RetainedRelationCandidate[] {
  retainedRelationFor(target, sha256); // validates table, hash and the current name's length
  return retainedRelationNamings().map((scheme) => {
    const relation = { schema: RETAINED_RELATION_SCHEMA, table: retainedRelationTableName(target.table, sha256, scheme) };
    assertIdentifier(relation.table, "retained relation");
    return { relation, scheme: scheme.scheme };
  });
}

export interface RetainedRelationResolution extends RetainedRelationCandidate {
  readonly exists: boolean;
}

/**
 * The relation a version IS retained in: the first candidate (current name, then legacy) that exists;
 * when none exists, the current-name candidate with `exists: false` (where a new copy would go).
 * Legacy relations are used as they are, never renamed.
 */
export async function resolveRetainedRelation(db: SqlPort, target: QualifiedTable, sha256: string): Promise<RetainedRelationResolution> {
  const candidates = retainedRelationCandidatesFor(target, sha256);
  for (const c of candidates) {
    if (await relationExists(db, c.relation)) return { ...c, exists: true };
  }
  return { ...candidates[0]!, exists: false };
}

/**
 * U30F2 M3: the record's relation must derive from the version's FULL hash under a known scheme, in
 * the retained-staging schema. Returns the scheme; throws otherwise (a name chosen by a caller is never
 * bound to a version it does not derive from).
 */
export function retainedRelationNamingFor(target: QualifiedTable, sha256: string, relation: QualifiedTable): string {
  const scheme = relation.schema === RETAINED_RELATION_SCHEMA ? retainedRelationNamingOf(target.table, sha256, relation.table) : null;
  if (!scheme) {
    throw invalid(
      `RETAINED_RELATION_NAME_NOT_BOUND: ${formatQualifiedTable(relation)} is not the retained relation of ${formatQualifiedTable(target)}@${sha256} ` +
        `under any naming scheme (${retainedRelationNamings().map((n) => n.scheme).join(", ")})`,
    );
  }
  return scheme.scheme;
}

function recordIdIn(namespace: string, target: QualifiedTable, sha256: string): string {
  assertIdentifier(target.schema, "schema");
  assertIdentifier(target.table, "table");
  assertVersionHash(sha256);
  const digest = createHash("sha256").update(`${namespace}\u0000${target.schema}.${target.table}\u0000${sha256}`, "utf8").digest("hex");
  return `spatial-dataset-retention-${digest.slice(0, 40)}`;
}

/**
 * Deterministic id of the VERIFIED record: one per (target, version hash), in the v2 namespace, so
 * a basis-less v1 record can never occupy it.
 */
export function retentionRecordId(target: QualifiedTable, sha256: string): string {
  return recordIdIn(SPATIAL_DATASET_RETENTION_CONTRACT_V2, target, sha256);
}

/** Id a legacy v1 (basis-less) record would have. Only consulted to keep a relation, never as verification. */
export function legacyV1RetentionRecordId(target: QualifiedTable, sha256: string): string {
  return recordIdIn(SPATIAL_DATASET_RETENTION_CONTRACT_V1, target, sha256);
}

/**
 * F9 (U30F): the retained relation's claim, keyed by the RELATION NAME alone. Written before every
 * verified record, so a staging cleanup or import can find "this relation holds a recorded version"
 * without the ledger (whose SUCCESS row may be gone) and without knowing the full version hash (an
 * 8-hex collision maps two versions to one name). WORM: a second version claiming the same relation
 * is a RECORD_CONFLICT.
 */
export const SPATIAL_DATASET_RETAINED_RELATION_CLAIM = "SPATIAL_DATASET_RETAINED_RELATION_CLAIM" as const;
export const SPATIAL_DATASET_RETAINED_RELATION_CLAIM_CONTRACT_V1 = "spatial-dataset-retained-relation-claim-v1" as const;

export interface RetainedRelationClaimPayload {
  readonly contract_version: typeof SPATIAL_DATASET_RETAINED_RELATION_CLAIM_CONTRACT_V1;
  readonly retained_relation: string;
  /** U30F2 M3: the scheme under which the relation name derives from `content_bundle_sha256`. */
  readonly retained_relation_naming: string;
  readonly target: QualifiedTable;
  readonly content_bundle_sha256: string;
  readonly retention_record_id: string;
}

export interface RetainedRelationClaim {
  readonly artifact_id: string;
  readonly artifact_type: typeof SPATIAL_DATASET_RETAINED_RELATION_CLAIM;
  readonly content_hash: ContentHash;
  readonly payload: RetainedRelationClaimPayload;
}

export function retainedRelationClaimId(relation: QualifiedTable): string {
  assertIdentifier(relation.schema, "schema");
  assertIdentifier(relation.table, "retained relation");
  const digest = createHash("sha256")
    .update(`${SPATIAL_DATASET_RETAINED_RELATION_CLAIM_CONTRACT_V1}\u0000${relation.schema}.${relation.table}`, "utf8")
    .digest("hex");
  return `spatial-dataset-retained-relation-claim-${digest.slice(0, 40)}`;
}

/** The claim on `relation`, or null when none exists; any other read failure propagates. */
export async function resolveRetainedRelationClaim(repo: ArtifactRepositoryPort, relation: QualifiedTable): Promise<RetainedRelationClaim | null> {
  const artifactId = retainedRelationClaimId(relation);
  try {
    return await repo.resolve<RetainedRelationClaim>({ artifact_id: artifactId, artifact_type: SPATIAL_DATASET_RETAINED_RELATION_CLAIM });
  } catch (error) {
    if (error instanceof Error && error.message === `Artifact not found: ${artifactId}`) return null;
    throw error;
  }
}

/** Legacy v1 record for (target, version), or null; never treated as verification. */
export async function resolveLegacyV1RetentionRecord(repo: ArtifactRepositoryPort, target: QualifiedTable, sha256: string): Promise<unknown | null> {
  const artifactId = legacyV1RetentionRecordId(target, sha256);
  try {
    return await repo.resolve({ artifact_id: artifactId, artifact_type: SPATIAL_DATASET_RETENTION_RECORD });
  } catch (error) {
    if (error instanceof Error && error.message === `Artifact not found: ${artifactId}`) return null;
    throw error;
  }
}

// ---------------------------------------------------------------------------------------------
// Catalog reads
// ---------------------------------------------------------------------------------------------

const LATEST_SUCCESS_BATCH_SQL = `
    SELECT id, content_bundle_sha256, dataset_version, row_count
    FROM "PostgisImportBatch"
    WHERE target_schema = $1 AND target_table = $2 AND status = 'SUCCESS'
    ORDER BY completed_at DESC NULLS LAST, imported_at DESC
    LIMIT 1`;

/** Latest SUCCESS batch for the target: the same selection as SpatialDatasetRuntimeBinding. */
export async function findCurrentSuccessBatch(db: SqlPort, target: QualifiedTable): Promise<ImportBatchRow | null> {
  quoteTable(target);
  const result = await db.query<ImportBatchRow>(LATEST_SUCCESS_BATCH_SQL, [target.schema, target.table]);
  return result.rows[0] ?? null;
}

/** All SUCCESS batches for the target, newest first, one per version hash. */
export async function listSuccessBatchVersions(db: SqlPort, target: QualifiedTable): Promise<ImportBatchRow[]> {
  quoteTable(target);
  const result = await db.query<ImportBatchRow>(
    `
    SELECT id, content_bundle_sha256, dataset_version, row_count
    FROM "PostgisImportBatch"
    WHERE target_schema = $1 AND target_table = $2 AND status = 'SUCCESS'
    ORDER BY completed_at DESC NULLS LAST, imported_at DESC`,
    [target.schema, target.table],
  );
  const seen = new Set<string>();
  const versions: ImportBatchRow[] = [];
  for (const row of result.rows) {
    if (seen.has(row.content_bundle_sha256)) continue;
    seen.add(row.content_bundle_sha256);
    versions.push(row);
  }
  return versions;
}

/** True when the relation holds at least one row (stops at the first row). */
export async function relationHasRows(db: SqlPort, relation: QualifiedTable): Promise<boolean> {
  const result = await db.query<{ has_rows: boolean }>(`SELECT EXISTS (SELECT 1 FROM ${quoteTable(relation)}) AS has_rows`);
  return Boolean(result.rows[0]?.has_rows);
}

export async function relationExists(db: SqlPort, relation: QualifiedTable): Promise<boolean> {
  const result = await db.query<{ exists: boolean }>(`SELECT to_regclass($1) IS NOT NULL AS exists`, [
    quoteTable(relation),
  ]);
  return Boolean(result.rows[0]?.exists);
}

export async function listRelationColumns(db: SqlPort, relation: QualifiedTable): Promise<RelationColumn[]> {
  quoteTable(relation);
  const result = await db.query<{ name: string; type: string; typname: string }>(
    `
    SELECT a.attname AS name, format_type(a.atttypid, a.atttypmod) AS type, t.typname AS typname
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_type t ON t.oid = a.atttypid
    WHERE n.nspname = $1 AND c.relname = $2 AND a.attnum > 0 AND NOT a.attisdropped
    ORDER BY a.attnum`,
    [relation.schema, relation.table],
  );
  return result.rows.map((r) => ({ name: r.name, type: r.type, typname: r.typname }));
}

/**
 * The digest column set: live columns that also exist in the retained relation, without `id`
 * (the same rule as importLibrarianQa.columnsForPromote), sorted; typed by the live table.
 */
export function digestColumns(
  liveColumns: readonly RelationColumn[],
  retainedColumns: readonly RelationColumn[],
): RelationColumn[] {
  const retained = new Set(retainedColumns.map((c) => c.name));
  return liveColumns
    .filter((c) => c.name !== "id" && retained.has(c.name))
    .slice()
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

// ---------------------------------------------------------------------------------------------
// Digest
// ---------------------------------------------------------------------------------------------

function digestExpression(column: RelationColumn): string {
  const ref = `src.${quoteIdent(column.name)}`;
  switch (column.typname) {
    case "geometry":
    case "geography":
      return `encode(ST_AsEWKB(${ref}::geometry), 'hex')`;
    case "timestamptz":
      return `to_char(${ref} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
    case "timetz":
      return `(${ref} AT TIME ZONE 'UTC')::time::text`;
    default:
      return `CAST(${ref} AS ${column.type})`;
  }
}

/** The V1 digest SQL for one relation (exported for review and tests; it is not user input). */
export function buildMaterializedDigestSql(relation: QualifiedTable, columns: readonly RelationColumn[]): string {
  if (columns.length === 0) {
    throw new SpatialDatasetRetentionError(
      SPATIAL_DATASET_RETENTION_FAILED,
      "NO_COMMON_COLUMNS",
      `no digest columns for ${formatQualifiedTable(relation)}`,
    );
  }
  for (const c of columns) assertIdentifier(c.name, "column");
  const projection = columns.map((c) => `${digestExpression(c)} AS ${quoteIdent(c.name)}`).join(", ");
  return `
    WITH row_hashes AS (
      SELECT encode(sha256(convert_to(to_jsonb(r)::text, 'UTF8')), 'hex') AS h
      FROM (SELECT ${projection} FROM ${quoteTable(relation)} src) r
    ), buckets AS (
      SELECT substr(h, 1, 2) AS b, count(*)::bigint AS n,
             encode(sha256(convert_to(string_agg(h, '' ORDER BY h COLLATE "C"), 'UTF8')), 'hex') AS d
      FROM row_hashes
      GROUP BY substr(h, 1, 2)
    )
    SELECT coalesce(sum(n), 0)::bigint AS row_count,
           encode(sha256(convert_to(coalesce(string_agg(b || ':' || n::text || ':' || d, E'\\n' ORDER BY b COLLATE "C"), ''), 'UTF8')), 'hex') AS digest
    FROM buckets`;
}

export async function computeMaterializedDigest(
  db: SqlPort,
  relation: QualifiedTable,
  columns: readonly RelationColumn[],
): Promise<MaterializedDigest> {
  const result = await db.query<{ row_count: number | string | bigint; digest: string }>(
    buildMaterializedDigestSql(relation, columns),
  );
  const row = result.rows[0];
  if (!row || typeof row.digest !== "string" || !SHA256_HEX.test(row.digest)) {
    throw new SpatialDatasetRetentionError(
      SPATIAL_DATASET_RETENTION_FAILED,
      "DATABASE_ERROR",
      `digest query for ${formatQualifiedTable(relation)} returned no digest`,
    );
  }
  return { row_count: Number(row.row_count), digest: row.digest };
}

// ---------------------------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------------------------

/** The batch's ledger row count as a number, or null when the ledger recorded none. */
export function ledgerRowCount(batch: ImportBatchRow): number | null {
  if (batch.row_count === null || batch.row_count === undefined) return null;
  const n = Number(batch.row_count);
  return Number.isFinite(n) ? n : null;
}

/**
 * The F3 basis check, shared by every writer: the retained digest must equal the live digest, and
 * the ledger's row count for the identifying batch (when recorded) must equal the retained rows.
 * Returns the basis; throws `code` [DIGEST_MISMATCH | LEDGER_ROW_COUNT_MISMATCH] otherwise.
 */
export function establishLiveEqualsRetainedBasis(input: {
  readonly code: SpatialDatasetRetentionError["code"];
  readonly target: QualifiedTable;
  readonly batch: ImportBatchRow;
  readonly retainedRelation: QualifiedTable;
  readonly live: MaterializedDigest;
  readonly retained: MaterializedDigest;
  readonly establishedBy: RetentionBasisEstablishedBy;
  readonly origin: RetainedRelationOrigin;
}): RetentionBasis {
  const { target, batch, retainedRelation, live, retained } = input;
  const label = `${formatQualifiedTable(target)}@${batch.content_bundle_sha256} (batch ${batch.id})`;
  if (live.row_count !== retained.row_count || live.digest !== retained.digest) {
    throw new SpatialDatasetRetentionError(
      input.code,
      "DIGEST_MISMATCH",
      `live ${formatQualifiedTable(target)} rows=${live.row_count} digest=${live.digest} != retained ` +
        `${formatQualifiedTable(retainedRelation)} rows=${retained.row_count} digest=${retained.digest} for ${label} ` +
        "(the retained relation does not hold the live version -- e.g. re-imported staging or an 8-hex name collision)",
    );
  }
  const ledgerRows = ledgerRowCount(batch);
  if (ledgerRows !== null && ledgerRows !== retained.row_count) {
    throw new SpatialDatasetRetentionError(
      input.code,
      "LEDGER_ROW_COUNT_MISMATCH",
      `the ledger records ${ledgerRows} rows for ${label} but ${formatQualifiedTable(retainedRelation)} and live hold ` +
        `${retained.row_count}: live no longer holds the version the batch admitted`,
    );
  }
  return {
    kind: "LIVE_EQUALS_RETAINED",
    established_by: input.establishedBy,
    version_batch_id: batch.id,
    version_hash: batch.content_bundle_sha256,
    live_relation: formatQualifiedTable(target),
    live_digest: { row_count: live.row_count, value: live.digest },
    ledger_row_count: ledgerRows,
    retained_relation_origin: input.origin,
  };
}

export function buildRetentionRecord(input: {
  readonly target: QualifiedTable;
  readonly batch: ImportBatchRow;
  readonly retainedRelation: QualifiedTable;
  readonly columns: readonly RelationColumn[];
  readonly digest: MaterializedDigest;
  readonly basis: RetentionBasis;
  readonly engineFingerprint?: SpatialEngineFingerprint;
}): SpatialDatasetRetentionRecord {
  if (
    input.basis.kind !== "LIVE_EQUALS_RETAINED" ||
    input.basis.version_hash !== input.batch.content_bundle_sha256 ||
    input.basis.version_batch_id !== input.batch.id ||
    input.basis.live_digest.value !== input.digest.digest ||
    input.basis.live_digest.row_count !== input.digest.row_count
  ) {
    throw new SpatialDatasetRetentionError(
      SPATIAL_DATASET_RETENTION_FAILED,
      "DIGEST_MISMATCH",
      `refusing to build a retention record for ${formatQualifiedTable(input.target)}@${input.batch.content_bundle_sha256} whose basis does not bind it`,
    );
  }
  const naming = retainedRelationNamingFor(input.target, input.batch.content_bundle_sha256, input.retainedRelation);
  const payload: SpatialDatasetRetentionPayload = {
    contract_version: SPATIAL_DATASET_RETENTION_CONTRACT_V2,
    target: { schema: input.target.schema, table: input.target.table },
    content_bundle_sha256: input.batch.content_bundle_sha256,
    import_batch_id: input.batch.id,
    dataset_version_label: input.batch.dataset_version ?? null,
    retained_relation: formatQualifiedTable(input.retainedRelation),
    retained_relation_naming: naming,
    columns: input.columns.map((c) => c.name),
    column_types: Object.fromEntries(input.columns.map((c) => [c.name, c.type])),
    row_count: input.digest.row_count,
    digest: { algorithm: MATERIALIZED_DIGEST_V1, value: input.digest.digest },
    engine_fingerprint: input.engineFingerprint ?? SPATIAL_STACK_V1,
    basis: input.basis,
  };
  return {
    artifact_id: retentionRecordId(input.target, input.batch.content_bundle_sha256),
    artifact_type: SPATIAL_DATASET_RETENTION_RECORD,
    content_hash: sha256ContentHash(payload),
    payload,
  };
}

function isArtifactNotFound(error: unknown, artifactId: string): boolean {
  return error instanceof Error && error.message === `Artifact not found: ${artifactId}`;
}

/**
 * The stored record for (target, version hash), or null when none exists. Any other read
 * failure propagates: an unreadable CAS is never "no record".
 */
export async function resolveRetentionRecord(
  repo: ArtifactRepositoryPort,
  target: QualifiedTable,
  sha256: string,
): Promise<SpatialDatasetRetentionRecord | null> {
  const artifactId = retentionRecordId(target, sha256);
  try {
    return await repo.resolve<SpatialDatasetRetentionRecord>({
      artifact_id: artifactId,
      artifact_type: SPATIAL_DATASET_RETENTION_RECORD,
    });
  } catch (error) {
    if (isArtifactNotFound(error, artifactId)) return null;
    throw error;
  }
}

/** F3: a stored record counts as verified only with a v2 payload whose basis binds its own version. */
export function hasVerifiedRetentionBasis(record: unknown): record is SpatialDatasetRetentionRecord {
  const payload = (record as { payload?: Partial<SpatialDatasetRetentionPayload> } | null)?.payload;
  const basis = payload?.basis;
  return (
    payload?.contract_version === SPATIAL_DATASET_RETENTION_CONTRACT_V2 &&
    basis?.kind === "LIVE_EQUALS_RETAINED" &&
    typeof basis.version_batch_id === "string" &&
    basis.version_hash === payload.content_bundle_sha256 &&
    basis.live_digest?.value === payload.digest?.value &&
    basis.live_digest?.row_count === payload.row_count
  );
}

function sameMaterialization(a: SpatialDatasetRetentionPayload, b: SpatialDatasetRetentionPayload): boolean {
  return (
    a.retained_relation === b.retained_relation &&
    a.row_count === b.row_count &&
    a.digest.algorithm === b.digest.algorithm &&
    a.digest.value === b.digest.value &&
    a.columns.length === b.columns.length &&
    a.columns.every((c, i) => c === b.columns[i])
  );
}

export type EnsureRecordOutcome = "RECORDED" | "ALREADY_RECORDED";

/**
 * Write the record, or verify the one already stored for (target, version hash). WORM: an
 * existing record for the same version with a different materialisation (relation, columns,
 * rows, digest) is a conflict, never overwritten. A record first written by an earlier batch of
 * the same version is accepted as is.
 */
export async function writeOrVerifyRetentionRecord(
  repo: ArtifactRepositoryPort,
  record: SpatialDatasetRetentionRecord,
  rejectCode: SpatialDatasetRetentionError["code"] = SPATIAL_DATASET_RETENTION_FAILED,
): Promise<{ readonly outcome: EnsureRecordOutcome; readonly record: SpatialDatasetRetentionRecord }> {
  // U30F2 M3: the relation must derive from the full hash under the scheme the record states.
  const bound = retainedRelationNamingFor(record.payload.target, record.payload.content_bundle_sha256, parseQualifiedTable(record.payload.retained_relation));
  if (bound !== record.payload.retained_relation_naming) {
    throw invalid(`RETAINED_RELATION_NAME_NOT_BOUND: ${record.payload.retained_relation} derives under ${bound}, the record states ${record.payload.retained_relation_naming}`);
  }
  let existing: SpatialDatasetRetentionRecord | null;
  try {
    existing = await resolveRetentionRecord(repo, record.payload.target, record.payload.content_bundle_sha256);
  } catch (error) {
    throw new SpatialDatasetRetentionError(rejectCode, "CAS_UNAVAILABLE", `reading retention record ${record.artifact_id}: ${describe(error)}`, {
      cause: error,
    });
  }
  if (existing) {
    if (!hasVerifiedRetentionBasis(existing)) {
      throw new SpatialDatasetRetentionError(
        rejectCode,
        "RECORD_CONFLICT",
        `retention record ${record.artifact_id} is stored without a verified basis (F3); it is never accepted as verification ` +
          "and, being WORM, cannot be overwritten -- an owner decision is needed",
      );
    }
    if (!sameMaterialization(existing.payload, record.payload)) {
      throw new SpatialDatasetRetentionError(
        rejectCode,
        "RECORD_CONFLICT",
        `retention record ${record.artifact_id} for ${formatQualifiedTable(record.payload.target)}@${record.payload.content_bundle_sha256} ` +
          `already records ${existing.payload.retained_relation} rows=${existing.payload.row_count} digest=${existing.payload.digest.value}, ` +
          `but ${record.payload.retained_relation} now has rows=${record.payload.row_count} digest=${record.payload.digest.value}`,
      );
    }
    await ensureRetainedRelationClaim(repo, existing, rejectCode);
    return { outcome: "ALREADY_RECORDED", record: existing };
  }
  await ensureRetainedRelationClaim(repo, record, rejectCode);
  try {
    await repo.put({ artifact_id: record.artifact_id, content_hash: record.content_hash, body: record });
  } catch (error) {
    throw new SpatialDatasetRetentionError(rejectCode, "CAS_UNAVAILABLE", `writing retention record ${record.artifact_id}: ${describe(error)}`, {
      cause: error,
    });
  }
  return { outcome: "RECORDED", record };
}

/** F9: write (or verify) the claim of the record's retained relation, before the record itself. */
async function ensureRetainedRelationClaim(
  repo: ArtifactRepositoryPort,
  record: SpatialDatasetRetentionRecord,
  rejectCode: SpatialDatasetRetentionError["code"],
): Promise<void> {
  const relation = parseQualifiedTable(record.payload.retained_relation);
  const claimId = retainedRelationClaimId(relation);
  let claim: RetainedRelationClaim | null;
  try {
    claim = await resolveRetainedRelationClaim(repo, relation);
  } catch (error) {
    throw new SpatialDatasetRetentionError(rejectCode, "CAS_UNAVAILABLE", `reading relation claim ${claimId}: ${describe(error)}`, { cause: error });
  }
  if (claim) {
    const p = claim.payload as Partial<RetainedRelationClaimPayload> | undefined;
    if (
      p?.content_bundle_sha256 !== record.payload.content_bundle_sha256 ||
      p?.target?.schema !== record.payload.target.schema ||
      p?.target?.table !== record.payload.target.table
    ) {
      throw new SpatialDatasetRetentionError(
        rejectCode,
        "RECORD_CONFLICT",
        `${record.payload.retained_relation} is already claimed by ${p?.target ? formatQualifiedTable(p.target as QualifiedTable) : "?"}@${p?.content_bundle_sha256 ?? "?"} ` +
          `(claim ${claimId}); ${formatQualifiedTable(record.payload.target)}@${record.payload.content_bundle_sha256} maps to the same relation ` +
          "(an 8-hex collision or a replaced relation) and cannot be recorded in it",
      );
    }
    return;
  }
  const payload: RetainedRelationClaimPayload = {
    contract_version: SPATIAL_DATASET_RETAINED_RELATION_CLAIM_CONTRACT_V1,
    retained_relation: record.payload.retained_relation,
    retained_relation_naming: record.payload.retained_relation_naming,
    target: { schema: record.payload.target.schema, table: record.payload.target.table },
    content_bundle_sha256: record.payload.content_bundle_sha256,
    retention_record_id: record.artifact_id,
  };
  const body: RetainedRelationClaim = {
    artifact_id: claimId,
    artifact_type: SPATIAL_DATASET_RETAINED_RELATION_CLAIM,
    content_hash: sha256ContentHash(payload),
    payload,
  };
  try {
    await repo.put({ artifact_id: claimId, content_hash: body.content_hash, body });
  } catch (error) {
    throw new SpatialDatasetRetentionError(rejectCode, "CAS_UNAVAILABLE", `writing relation claim ${claimId}: ${describe(error)}`, { cause: error });
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ---------------------------------------------------------------------------------------------
// Gate: retain the outgoing version, then replace
// ---------------------------------------------------------------------------------------------

/**
 * Inside the caller's transaction, with the target locked: verify that `outgoing` is retained
 * (relation present, retained digest = live digest) and that its record is in CAS. Throws
 * REJECT_PROMOTE_OUTGOING_VERSION_NOT_RETAINED on any failure.
 */
export async function ensureOutgoingVersionRetained(input: {
  readonly db: SqlPort;
  readonly repo: ArtifactRepositoryPort;
  readonly target: QualifiedTable;
  readonly outgoing: ImportBatchRow;
  /** How the retained relation came to be (the gate passes CTAS_FROM_LIVE_AT_REPLACE when its phase A made it). */
  readonly origin?: RetainedRelationOrigin;
}): Promise<{ readonly outcome: EnsureRecordOutcome; readonly record: SpatialDatasetRetentionRecord }> {
  const reject = (reason: SpatialDatasetRetentionFailureReason, message: string, cause?: unknown) =>
    new SpatialDatasetRetentionError(REJECT_PROMOTE_OUTGOING_VERSION_NOT_RETAINED, reason, message, { cause });
  const { db, repo, target, outgoing } = input;
  const label = `${formatQualifiedTable(target)}@${outgoing.content_bundle_sha256} (batch ${outgoing.id})`;

  let retained: QualifiedTable;
  let liveDigest: MaterializedDigest;
  let retainedDigest: MaterializedDigest;
  let columns: RelationColumn[];
  try {
    const resolved = await resolveRetainedRelation(db, target, outgoing.content_bundle_sha256);
    retained = resolved.relation;
    if (!resolved.exists) {
      throw reject(
        "RETAINED_RELATION_MISSING",
        `outgoing version ${label} has no retained relation (${retainedRelationCandidatesFor(target, outgoing.content_bundle_sha256).map((c) => formatQualifiedTable(c.relation)).join(" or ")})`,
      );
    }
    columns = digestColumns(await listRelationColumns(db, target), await listRelationColumns(db, retained));
    if (columns.length === 0) {
      throw reject("NO_COMMON_COLUMNS", `${formatQualifiedTable(retained)} shares no promote columns with ${formatQualifiedTable(target)}`);
    }
    liveDigest = await computeMaterializedDigest(db, target, columns);
    retainedDigest = await computeMaterializedDigest(db, retained, columns);
  } catch (error) {
    if (error instanceof SpatialDatasetRetentionError) {
      if (error.code === REJECT_PROMOTE_OUTGOING_VERSION_NOT_RETAINED) throw error;
      throw reject(error.reason, error.message, error);
    }
    throw reject("DATABASE_ERROR", `checking retention of ${label}: ${describe(error)}`, error);
  }

  const basis = establishLiveEqualsRetainedBasis({
    code: REJECT_PROMOTE_OUTGOING_VERSION_NOT_RETAINED,
    target,
    batch: outgoing,
    retainedRelation: retained,
    live: liveDigest,
    retained: retainedDigest,
    establishedBy: "REPLACE_OUTGOING",
    origin: input.origin ?? "PRE_EXISTING_RELATION",
  });
  const record = buildRetentionRecord({ target, batch: outgoing, retainedRelation: retained, columns, digest: retainedDigest, basis });
  return writeOrVerifyRetentionRecord(repo, record, REJECT_PROMOTE_OUTGOING_VERSION_NOT_RETAINED);
}

export type ReplaceRetentionStatus =
  | { readonly kind: "RETAINED"; readonly outcome: EnsureRecordOutcome; readonly record: SpatialDatasetRetentionRecord; readonly created_retained_relation: boolean }
  /**
   * F5: first import into an EMPTY live table (no SUCCESS batch, no row -- checked again under the
   * exclusive lock): nothing exists that could be replaced.
   */
  | { readonly kind: "FIRST_IMPORT_EMPTY_LIVE" };

/**
 * PRES-05 replace: retain the outgoing version, then TRUNCATE + INSERT.
 *
 * Phase A (own committed transaction, SHARE lock on the target): when the outgoing version's
 * retained relation is missing, materialise it as a CTAS copy of live. Committed first, so a
 * failed replace never leaves a CAS record pointing at a rolled-back relation.
 * Phase B (one transaction, ACCESS EXCLUSIVE lock on the target): the outgoing SUCCESS batch must
 * be unchanged since phase A; `ensureOutgoingVersionRetained`; only then TRUNCATE and `insertSql`.
 * Any failure rolls back phase B with no TRUNCATE executed.
 *
 * F5 (U30F): the ledger's SUCCESS batch is the only admission identity that says WHAT is being
 * replaced. When there is none and the live table holds rows, the promote is refused
 * (NO_SUCCESS_BATCH_FOR_LIVE_DATA) -- no TRUNCATE, no promotion -- even if CAS holds a retention
 * record for some version: a CAS record never stands in for the batch identity. Only a first import
 * into an empty live table (FIRST_IMPORT_EMPTY_LIVE) proceeds without a SUCCESS batch.
 */
export async function retainOutgoingThenReplace(input: {
  readonly db: TransactionalSqlPort;
  readonly repo: ArtifactRepositoryPort;
  readonly target: QualifiedTable;
  /** The named-column `INSERT INTO target (...) SELECT ... FROM staging` statement. */
  readonly insertSql: string;
}): Promise<ReplaceRetentionStatus> {
  const { db, repo, target, insertSql } = input;
  const reject = (reason: SpatialDatasetRetentionFailureReason, message: string, cause?: unknown) =>
    new SpatialDatasetRetentionError(REJECT_PROMOTE_OUTGOING_VERSION_NOT_RETAINED, reason, message, { cause });

  // F4: hard precondition, before any statement (the committed preconditions file; no override).
  const precondition = committedRetentionDigestPrecondition(target);
  if (precondition.kind === "UNMET") throw reject("DIGEST_TIME_PRECONDITION_UNMET", precondition.detail);

  // Phase A
  let targetSql: string;
  let outgoing: ImportBatchRow | null;
  let createdRetainedRelation = false;
  const noSuccessBatch = () =>
    reject(
      "NO_SUCCESS_BATCH_FOR_LIVE_DATA",
      `${formatQualifiedTable(target)} holds rows but the ledger has no SUCCESS batch for it: what would be replaced has no ` +
        "admission identity, so it cannot be retained or bound (a CAS retention record does not stand in for it). " +
        "Promote refused; nothing truncated.",
    );
  try {
    targetSql = quoteTable(target);
    outgoing = await findCurrentSuccessBatch(db, target);
    if (!outgoing && (await relationHasRows(db, target))) throw noSuccessBatch();
    if (outgoing) {
      const sha = outgoing.content_bundle_sha256;
      if (!(await resolveRetainedRelation(db, target, sha)).exists) {
        createdRetainedRelation = await db.transaction(async (tx) => {
          await tx.execute(`LOCK TABLE ${targetSql} IN SHARE MODE`);
          const again = await resolveRetainedRelation(tx, target, sha);
          if (again.exists) return false;
          // U30F2 M3: a relation made now gets the current (24 hex) name.
          await tx.execute(`CREATE SCHEMA IF NOT EXISTS ${quoteIdent(RETAINED_RELATION_SCHEMA)}`);
          await tx.execute(`CREATE TABLE ${quoteTable(again.relation)} AS SELECT * FROM ${targetSql}`);
          return true;
        });
      }
    }
  } catch (error) {
    if (error instanceof SpatialDatasetRetentionError) {
      if (error.code === REJECT_PROMOTE_OUTGOING_VERSION_NOT_RETAINED) throw error;
      throw reject(error.reason, error.message, error);
    }
    throw reject("DATABASE_ERROR", `preparing retention for ${formatQualifiedTable(target)}: ${describe(error)}`, error);
  }

  // Phase B
  return db.transaction(async (tx) => {
    await tx.execute(`LOCK TABLE ${targetSql} IN ACCESS EXCLUSIVE MODE`);
    const current = await findCurrentSuccessBatch(tx, target);
    if ((current?.id ?? null) !== (outgoing?.id ?? null)) {
      throw reject(
        "OUTGOING_VERSION_CHANGED",
        `the current SUCCESS batch for ${formatQualifiedTable(target)} changed during promote (${outgoing?.id ?? "none"} -> ${current?.id ?? "none"})`,
      );
    }
    let status: ReplaceRetentionStatus;
    if (current) {
      const ensured = await ensureOutgoingVersionRetained({
        db: tx,
        repo,
        target,
        outgoing: current,
        origin: createdRetainedRelation ? "CTAS_FROM_LIVE_AT_REPLACE" : "PRE_EXISTING_RELATION",
      });
      status = { kind: "RETAINED", outcome: ensured.outcome, record: ensured.record, created_retained_relation: createdRetainedRelation };
    } else {
      // F5: re-checked under the exclusive lock -- rows that arrived since phase A are not replaced.
      if (await relationHasRows(tx, target)) throw noSuccessBatch();
      status = { kind: "FIRST_IMPORT_EMPTY_LIVE" };
    }
    await tx.execute(`TRUNCATE ${targetSql}`);
    await tx.execute(insertSql);
    return status;
  });
}

/**
 * After a SUCCESS promote: record the incoming version's retention from birth (its staging
 * relation, verified equal to live). Throws SPATIAL_DATASET_RETENTION_FAILED; the caller decides
 * how loudly (the data is already promoted, so this must not mark the batch FAILED).
 */
export async function recordRetentionAtPromote(input: {
  readonly db: SqlPort;
  readonly repo: ArtifactRepositoryPort;
  readonly target: QualifiedTable;
  readonly incoming: ImportBatchRow;
}): Promise<{ readonly outcome: EnsureRecordOutcome; readonly record: SpatialDatasetRetentionRecord }> {
  const { db, repo, target, incoming } = input;
  const fail = (reason: SpatialDatasetRetentionFailureReason, message: string, cause?: unknown) =>
    new SpatialDatasetRetentionError(SPATIAL_DATASET_RETENTION_FAILED, reason, message, { cause });
  let retained: QualifiedTable = retainedRelationFor(target, incoming.content_bundle_sha256);
  let columns: RelationColumn[];
  let liveDigest: MaterializedDigest;
  let retainedDigest: MaterializedDigest;
  try {
    const resolved = await resolveRetainedRelation(db, target, incoming.content_bundle_sha256);
    retained = resolved.relation;
    if (!resolved.exists) {
      throw fail("RETAINED_RELATION_MISSING", `incoming version has no staging relation ${formatQualifiedTable(retained)} (nor a legacy-named one)`);
    }
    columns = digestColumns(await listRelationColumns(db, target), await listRelationColumns(db, retained));
    liveDigest = await computeMaterializedDigest(db, target, columns);
    retainedDigest = await computeMaterializedDigest(db, retained, columns);
  } catch (error) {
    if (error instanceof SpatialDatasetRetentionError) throw error;
    throw fail("DATABASE_ERROR", `recording retention of ${formatQualifiedTable(target)}: ${describe(error)}`, error);
  }
  const basis = establishLiveEqualsRetainedBasis({
    code: SPATIAL_DATASET_RETENTION_FAILED,
    target,
    batch: incoming,
    retainedRelation: retained,
    live: liveDigest,
    retained: retainedDigest,
    establishedBy: "PROMOTE_INCOMING",
    origin: "STAGING_IMPORT_PROMOTED_FROM",
  });
  const record = buildRetentionRecord({ target, batch: incoming, retainedRelation: retained, columns, digest: retainedDigest, basis });
  return writeOrVerifyRetentionRecord(repo, record);
}

/**
 * U30F2 M3: SQL that is true when a ledger row's `<target_table>_<hash prefix>` equals `param`
 * under ANY naming scheme (current and legacy digest lengths, from the shared specification).
 */
export function retainedRelationNameMatchSql(param: string): string {
  return retainedRelationDigestLengths()
    .map((n) => {
      if (!Number.isInteger(n)) throw invalid("digest length");
      return `target_table || '_' || substr(content_bundle_sha256, 1, ${n}) = ${param}`;
    })
    .join(" OR ");
}

/**
 * True when `relation` (in lm_staging) is the retained relation of a SUCCESS batch: a staging
 * cleanup must never drop it. (Wiring into cleanup-staging is a separate step.)
 */
export async function isRetainedRelationProtected(db: SqlPort, relation: QualifiedTable): Promise<boolean> {
  quoteTable(relation);
  if (relation.schema !== RETAINED_RELATION_SCHEMA) return false;
  const result = await db.query<{ protected: boolean }>(
    `
    SELECT EXISTS (
      SELECT 1 FROM "PostgisImportBatch"
      WHERE status = 'SUCCESS' AND (${retainedRelationNameMatchSql("$1")})
    ) AS protected`,
    [relation.table],
  );
  return Boolean(result.rows[0]?.protected);
}

// ---------------------------------------------------------------------------------------------
// Backfill (ops CLI, owner-approved run only): read DB, write CAS
// ---------------------------------------------------------------------------------------------

export type BackfillStatus =
  | "RECORDED"
  | "ALREADY_RECORDED"
  | "WOULD_RECORD"
  | "NOT_RETAINED_RELATION_MISSING"
  | "DIGEST_MISMATCH"
  /** F3: the ledger's row count for the current batch differs from the rows live and retained hold. */
  | "LEDGER_ROW_COUNT_MISMATCH"
  /**
   * F3: a superseded version. Live no longer holds it and nothing else records its rows, so its
   * retained relation cannot be compared with anything: never recorded (no record, no "upgrade").
   */
  | "UNVERIFIED_BASIS"
  /** F4: the target's digest time is an unmet hard precondition; nothing was digested. */
  | "PRECONDITION_UNMET"
  | "FAILED";

export interface BackfillVersionResult {
  readonly target: string;
  readonly content_bundle_sha256: string;
  readonly import_batch_id: string;
  readonly current: boolean;
  readonly retained_relation: string;
  readonly status: BackfillStatus;
  readonly record_id: string;
  readonly row_count?: number;
  readonly digest?: string;
  readonly detail?: string;
}

/**
 * Backfill retention records for the SUCCESS versions of `targets`. Read-only against the database
 * (no CTAS: a missing retained relation is reported, not created); writes to CAS only when
 * `execute` and a repository are given.
 *
 * F3: only the CURRENT version can be recorded, and only on the same basis as the gate (retained
 * digest = live digest, ledger row count agrees). A superseded version is reported UNVERIFIED_BASIS
 * and never recorded: live no longer holds it, the ledger holds no row digest, so hashing its
 * relation now would only certify whatever the relation holds today. Its relation is not digested.
 */
export async function backfillSpatialDatasetRetention(input: {
  readonly db: SqlPort;
  readonly repo: ArtifactRepositoryPort | null;
  readonly targets: readonly QualifiedTable[];
  readonly execute: boolean;
  readonly onResult?: (result: BackfillVersionResult) => void;
}): Promise<BackfillVersionResult[]> {
  const { db, repo, targets, execute } = input;
  if (execute && !repo) {
    throw new SpatialDatasetRetentionError(SPATIAL_DATASET_RETENTION_FAILED, "CAS_UNAVAILABLE", "--execute needs the durable CAS");
  }
  const results: BackfillVersionResult[] = [];
  const emit = (r: BackfillVersionResult) => {
    results.push(r);
    input.onResult?.(r);
  };
  for (const target of targets) {
    const versions = await listSuccessBatchVersions(db, target);
    const precondition = committedRetentionDigestPrecondition(target);
    if (precondition.kind === "UNMET") {
      for (const batch of versions) {
        emit({
          target: formatQualifiedTable(target),
          content_bundle_sha256: batch.content_bundle_sha256,
          import_batch_id: batch.id,
          current: batch === versions[0],
          retained_relation: formatQualifiedTable(retainedRelationFor(target, batch.content_bundle_sha256)),
          record_id: retentionRecordId(target, batch.content_bundle_sha256),
          status: "PRECONDITION_UNMET",
          detail: precondition.detail,
        });
      }
      continue;
    }
    const liveColumns = await listRelationColumns(db, target);
    let liveDigestCache: { key: string; digest: MaterializedDigest } | null = null;
    for (const [index, batch] of versions.entries()) {
      const current = index === 0;
      let retained = retainedRelationFor(target, batch.content_bundle_sha256);
      let exists = false;
      try {
        const resolved = await resolveRetainedRelation(db, target, batch.content_bundle_sha256);
        retained = resolved.relation;
        exists = resolved.exists;
      } catch (error) {
        emit({
          target: formatQualifiedTable(target),
          content_bundle_sha256: batch.content_bundle_sha256,
          import_batch_id: batch.id,
          current,
          retained_relation: formatQualifiedTable(retained),
          record_id: retentionRecordId(target, batch.content_bundle_sha256),
          status: "FAILED",
          detail: describe(error),
        });
        continue;
      }
      const base = {
        target: formatQualifiedTable(target),
        content_bundle_sha256: batch.content_bundle_sha256,
        import_batch_id: batch.id,
        current,
        retained_relation: formatQualifiedTable(retained),
        record_id: retentionRecordId(target, batch.content_bundle_sha256),
      };
      try {
        if (!exists) {
          emit({ ...base, status: "NOT_RETAINED_RELATION_MISSING", detail: current ? "the next promote creates it (CTAS) before replacing" : "bytes of this version are no longer materialised" });
          continue;
        }
        if (!current) {
          emit({
            ...base,
            status: "UNVERIFIED_BASIS",
            detail:
              "superseded version: live no longer holds it and no recorded row digest exists, so its retained relation " +
              "cannot be compared with anything; not recorded (F3)",
          });
          continue;
        }
        const columns = digestColumns(liveColumns, await listRelationColumns(db, retained));
        const retainedDigest = await computeMaterializedDigest(db, retained, columns);
        const key = columns.map((c) => c.name).join(",");
        if (!liveDigestCache || liveDigestCache.key !== key) {
          liveDigestCache = { key, digest: await computeMaterializedDigest(db, target, columns) };
        }
        const live = liveDigestCache.digest;
        let basis: RetentionBasis;
        try {
          basis = establishLiveEqualsRetainedBasis({
            code: SPATIAL_DATASET_RETENTION_FAILED,
            target,
            batch,
            retainedRelation: retained,
            live,
            retained: retainedDigest,
            establishedBy: "BACKFILL_CURRENT",
            origin: "PRE_EXISTING_RELATION",
          });
        } catch (error) {
          if (error instanceof SpatialDatasetRetentionError && (error.reason === "DIGEST_MISMATCH" || error.reason === "LEDGER_ROW_COUNT_MISMATCH")) {
            emit({ ...base, status: error.reason, row_count: retainedDigest.row_count, digest: retainedDigest.digest, detail: error.message });
            continue;
          }
          throw error;
        }
        const record = buildRetentionRecord({ target, batch, retainedRelation: retained, columns, digest: retainedDigest, basis });
        if (!execute || !repo) {
          emit({ ...base, status: "WOULD_RECORD", row_count: retainedDigest.row_count, digest: retainedDigest.digest });
          continue;
        }
        const written = await writeOrVerifyRetentionRecord(repo, record);
        emit({ ...base, status: written.outcome, row_count: retainedDigest.row_count, digest: retainedDigest.digest });
      } catch (error) {
        emit({ ...base, status: "FAILED", detail: describe(error) });
      }
    }
  }
  return results;
}

// ---------------------------------------------------------------------------------------------
// F4 measurement (ops CLI --measure-digest, owner-approved run only): read DB, write nothing
// ---------------------------------------------------------------------------------------------

export interface DigestTimeMeasurement {
  readonly target: string;
  readonly current_batch_id: string | null;
  readonly live: { readonly rows: number; readonly seconds: number };
  readonly retained: { readonly relation: string; readonly rows: number; readonly seconds: number } | null;
  /** The larger of the two: what ONE digest under the lock takes (the precondition's measured_digest_seconds). */
  readonly measured_digest_seconds: number;
}

/**
 * Time the digests a replace promote would compute under the lock: the live table and the current
 * version's retained relation (when present), over the same column set. Read-only; no CAS, no
 * record. The result is evidence for an owner to commit into retention-digest-preconditions.v1.json;
 * nothing here marks the precondition met.
 */
export async function measureRetentionDigestTimes(input: {
  readonly db: SqlPort;
  readonly targets: readonly QualifiedTable[];
  /** Monotonic clock in milliseconds. */
  readonly now: () => number;
  readonly onResult?: (result: DigestTimeMeasurement) => void;
}): Promise<DigestTimeMeasurement[]> {
  const results: DigestTimeMeasurement[] = [];
  for (const target of input.targets) {
    const current = await findCurrentSuccessBatch(input.db, target);
    const liveColumns = await listRelationColumns(input.db, target);
    const resolved = current ? await resolveRetainedRelation(input.db, target, current.content_bundle_sha256) : null;
    const retained = resolved ? resolved.relation : null;
    const retainedPresent = resolved ? resolved.exists : false;
    const columns = digestColumns(liveColumns, retainedPresent && retained ? await listRelationColumns(input.db, retained) : liveColumns);
    const timed = async (relation: QualifiedTable) => {
      const started = input.now();
      const digest = await computeMaterializedDigest(input.db, relation, columns);
      return { rows: digest.row_count, seconds: (input.now() - started) / 1000 };
    };
    const live = await timed(target);
    const retainedTime = retainedPresent && retained ? { relation: formatQualifiedTable(retained), ...(await timed(retained)) } : null;
    const result: DigestTimeMeasurement = {
      target: formatQualifiedTable(target),
      current_batch_id: current?.id ?? null,
      live,
      retained: retainedTime,
      measured_digest_seconds: Math.max(live.seconds, retainedTime?.seconds ?? 0),
    };
    results.push(result);
    input.onResult?.(result);
  }
  return results;
}
