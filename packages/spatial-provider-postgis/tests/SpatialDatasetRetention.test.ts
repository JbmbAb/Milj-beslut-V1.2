import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { InMemoryArtifactRepository } from "../../mps-runtime/src/repository/InMemoryArtifactRepository";
import { sha256ContentHash, type ArtifactRepositoryPort } from "../../mps-runtime/src/kernel/ExecutionKernel";
import {
  MATERIALIZED_DIGEST_V1,
  REJECT_PROMOTE_OUTGOING_VERSION_NOT_RETAINED,
  SPATIAL_DATASET_RETENTION_FAILED,
  SPATIAL_DATASET_RETENTION_RECORD,
  SpatialDatasetRetentionError,
  backfillSpatialDatasetRetention,
  buildMaterializedDigestSql,
  digestColumns,
  isRetainedRelationProtected,
  measureRetentionDigestTimes,
  parseQualifiedTable,
  recordRetentionAtPromote,
  resolveRetentionRecord,
  retainOutgoingThenReplace,
  retainedRelationFor,
  retentionRecordId,
  type ImportBatchRow,
  type MaterializedDigest,
  type RelationColumn,
  type SpatialDatasetRetentionRecord,
  type SqlPort,
  type TransactionalSqlPort,
} from "../src/SpatialDatasetRetention";

/**
 * SPATIAL-DATASET-RETENTION-V1 (U30-B, PRES-05) -- hermetic.
 *
 * No database: a scripted fake SQL port answers the catalog/digest queries from an in-memory
 * table model and records every statement in one call log, together with the CAS writes, so the
 * ORDER of "record retention" and "TRUNCATE" is observable. The digest values are canned per
 * relation (PostgreSQL's sha256 is not under test here; the gate logic is). The CAS is
 * InMemoryArtifactRepository.
 */

const HASH_V1 = "2b4b514f8b18a1a614d9aeac75c32eff8c52a3864c54770be112fd88fa263ddc";
const HASH_V2 = "aaaabbbb00000000000000000000000000000000000000000000000000000001";
const TARGET = { schema: "env", table: "sgu_well" } as const;
const INSERT_SQL = 'INSERT INTO env.sgu_well ("brunnsid", "geom") SELECT "brunnsid", "geom" FROM lm_staging.sgu_well_aaaabbbb';

const LIVE_COLUMNS: RelationColumn[] = [
  { name: "id", type: "integer", typname: "int4" },
  { name: "brunnsid", type: "character varying(32)", typname: "varchar" },
  { name: "geom", type: "geometry(Point,3006)", typname: "geometry" },
];
const STAGING_COLUMNS: RelationColumn[] = [
  { name: "ogc_fid", type: "integer", typname: "int4" },
  { name: "brunnsid", type: "character varying", typname: "varchar" },
  { name: "geom", type: "geometry(Point,3006)", typname: "geometry" },
];

const D_V1: MaterializedDigest = { row_count: 831332, digest: "1".repeat(64) };
const D_OTHER: MaterializedDigest = { row_count: 831332, digest: "f".repeat(64) };

function batch(id: string, sha: string): ImportBatchRow {
  return { id, content_bundle_sha256: sha, dataset_version: `label-${id}` };
}

type FakeTable = { columns: RelationColumn[]; digest: MaterializedDigest };

class FakeDb implements TransactionalSqlPort {
  readonly log: string[] = [];
  readonly tables = new Map<string, FakeTable>();
  successBatches: ImportBatchRow[] = [];
  /** Returned by the LIMIT 1 lookup on its Nth call (1-based), to simulate a concurrent change. */
  currentBatchOverride: { onCall: number; row: ImportBatchRow | null } | null = null;
  failOn: RegExp | null = null;
  /** Answer of the "live has rows" probe on its Nth call (1-based), to simulate a concurrent insert. */
  hasRowsOverride: { onCall: number; value: boolean } | null = null;
  private currentLookups = 0;
  private hasRowsLookups = 0;

  async query<T = Record<string, unknown>>(sql: string, params: readonly unknown[] = []): Promise<{ rows: T[] }> {
    const s = sql.replace(/\s+/g, " ").trim();
    if (this.failOn?.test(s)) throw new Error("simulated database failure");
    if (s.includes('FROM "PostgisImportBatch"') && s.includes("EXISTS")) {
      const name = String(params[0]);
      const hit = this.successBatches.some((b) => `${TARGET.table}_${b.content_bundle_sha256.slice(0, 8)}` === name);
      return { rows: [{ protected: hit }] as T[] };
    }
    if (s.includes('FROM "PostgisImportBatch"') && s.includes("LIMIT 1")) {
      this.currentLookups += 1;
      this.log.push("query:current-batch");
      if (this.currentBatchOverride && this.currentBatchOverride.onCall === this.currentLookups) {
        return { rows: (this.currentBatchOverride.row ? [this.currentBatchOverride.row] : []) as T[] };
      }
      return { rows: this.successBatches.slice(0, 1) as T[] };
    }
    if (s.includes('FROM "PostgisImportBatch"')) {
      this.log.push("query:success-batches");
      return { rows: this.successBatches as T[] };
    }
    if (s.startsWith("SELECT to_regclass")) {
      const key = String(params[0]).replace(/"/g, "");
      return { rows: [{ exists: this.tables.has(key) }] as T[] };
    }
    if (s.startsWith("SELECT EXISTS (SELECT 1 FROM")) {
      const m = s.match(/FROM "([^"]+)"\."([^"]+)"/);
      const key = `${m![1]}.${m![2]}`;
      this.hasRowsLookups += 1;
      this.log.push(`has-rows:${key}`);
      if (this.hasRowsOverride && this.hasRowsOverride.onCall === this.hasRowsLookups) {
        return { rows: [{ has_rows: this.hasRowsOverride.value }] as T[] };
      }
      const t = this.tables.get(key);
      if (!t) throw new Error(`relation ${key} does not exist`);
      return { rows: [{ has_rows: t.digest.row_count > 0 }] as T[] };
    }
    if (s.includes("FROM pg_attribute")) {
      const t = this.tables.get(`${params[0]}.${params[1]}`);
      return { rows: (t ? t.columns : []) as T[] };
    }
    if (s.startsWith("WITH row_hashes")) {
      const m = s.match(/FROM "([^"]+)"\."([^"]+)" src/);
      const key = `${m![1]}.${m![2]}`;
      this.log.push(`digest:${key}`);
      const t = this.tables.get(key);
      if (!t) throw new Error(`relation ${key} does not exist`);
      return { rows: [{ row_count: String(t.digest.row_count), digest: t.digest.digest }] as T[] };
    }
    throw new Error(`unexpected query: ${s}`);
  }

  async execute(sql: string): Promise<void> {
    const s = sql.replace(/\s+/g, " ").trim();
    if (this.failOn?.test(s)) throw new Error("simulated database failure");
    if (s.startsWith("LOCK TABLE")) this.log.push(`lock:${s.includes("ACCESS EXCLUSIVE") ? "ACCESS EXCLUSIVE" : "SHARE"}`);
    else if (s.startsWith("CREATE SCHEMA")) this.log.push("create-schema");
    else if (s.startsWith("CREATE TABLE")) {
      const m = s.match(/^CREATE TABLE "([^"]+)"\."([^"]+)" AS SELECT \* FROM "([^"]+)"\."([^"]+)"$/);
      if (!m) throw new Error(`unexpected CTAS: ${s}`);
      const source = this.tables.get(`${m[3]}.${m[4]}`)!;
      this.tables.set(`${m[1]}.${m[2]}`, { columns: [...source.columns], digest: { ...source.digest } });
      this.log.push(`ctas:${m[1]}.${m[2]}`);
    } else if (s.startsWith("TRUNCATE")) this.log.push("TRUNCATE");
    else if (s.startsWith("INSERT")) this.log.push("INSERT");
    else throw new Error(`unexpected statement: ${s}`);
  }

  async transaction<T>(work: (tx: SqlPort) => Promise<T>): Promise<T> {
    this.log.push("BEGIN");
    try {
      const result = await work(this);
      this.log.push("COMMIT");
      return result;
    } catch (error) {
      this.log.push("ROLLBACK");
      throw error;
    }
  }
}

/** CAS that records its writes into the DB fake's log, so CAS-vs-TRUNCATE order is observable. */
function loggingRepo(db: FakeDb, inner: ArtifactRepositoryPort = new InMemoryArtifactRepository()): ArtifactRepositoryPort {
  return {
    async put(artifact) {
      db.log.push(`cas:put:${artifact.artifact_id}`);
      await inner.put(artifact);
    },
    resolve: (ref) => inner.resolve(ref),
  };
}

function failingRepo(mode: "put" | "resolve"): ArtifactRepositoryPort {
  const inner = new InMemoryArtifactRepository();
  return {
    async put(artifact) {
      if (mode === "put") throw new Error("ENOSPC: CAS volume full");
      await inner.put(artifact);
    },
    async resolve(ref) {
      if (mode === "resolve") throw new Error("MIMERS_ARTIFACT_INDEX_READ_FAILED: simulated unreadable index entry");
      return inner.resolve(ref);
    },
  };
}

/** Live table holding v1, retained v1 relation present with the same digest; v2 staged. */
function retainedScenario(): FakeDb {
  const db = new FakeDb();
  db.successBatches = [batch("batch-v1", HASH_V1)];
  db.tables.set("env.sgu_well", { columns: LIVE_COLUMNS, digest: D_V1 });
  db.tables.set("lm_staging.sgu_well_2b4b514f", { columns: STAGING_COLUMNS, digest: D_V1 });
  db.tables.set("lm_staging.sgu_well_aaaabbbb", { columns: STAGING_COLUMNS, digest: D_OTHER });
  return db;
}

async function rejection(promise: Promise<unknown>): Promise<SpatialDatasetRetentionError> {
  const error = await promise.then(
    () => {
      throw new Error("expected a rejection");
    },
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(SpatialDatasetRetentionError);
  return error as SpatialDatasetRetentionError;
}

describe("identifiers and record ids", () => {
  it("retained relation = lm_staging.<table>_<hash8>, the staging table the version was promoted from", () => {
    expect(retainedRelationFor(TARGET, HASH_V1)).toEqual({ schema: "lm_staging", table: "sgu_well_2b4b514f" });
  });

  it("record id is deterministic per (target, version hash) and distinct across both", () => {
    const id = retentionRecordId(TARGET, HASH_V1);
    expect(id).toMatch(/^spatial-dataset-retention-[0-9a-f]{40}$/);
    expect(retentionRecordId({ schema: "env", table: "sgu_well" }, HASH_V1)).toBe(id);
    expect(retentionRecordId(TARGET, HASH_V2)).not.toBe(id);
    expect(retentionRecordId({ schema: "env", table: "ebh_potentiellt_fororenade_omraden" }, HASH_V1)).not.toBe(id);
  });

  it.each([
    ["injection in table", () => retainedRelationFor({ schema: "env", table: "x; DROP TABLE y" }, HASH_V1)],
    ["upper-case hash", () => retainedRelationFor(TARGET, HASH_V1.toUpperCase())],
    ["short hash", () => retentionRecordId(TARGET, "2b4b514f")],
    ["unqualified", () => parseQualifiedTable("sgu_well")],
    ["over-long retained name", () => retainedRelationFor({ schema: "env", table: "t".repeat(60) }, HASH_V1)],
  ])("rejects %s", (_label, fn) => {
    expect(fn).toThrow(SpatialDatasetRetentionError);
  });
});

describe("digest definition", () => {
  it("digest columns: live ∩ retained, without id, sorted, typed by live", () => {
    expect(digestColumns(LIVE_COLUMNS, STAGING_COLUMNS)).toEqual([
      { name: "brunnsid", type: "character varying(32)", typname: "varchar" },
      { name: "geom", type: "geometry(Point,3006)", typname: "geometry" },
    ]);
  });

  it("V1 SQL hashes rows as jsonb, geometry as EWKB, timestamptz in UTC, buckets sorted in C collation", () => {
    const sql = buildMaterializedDigestSql({ schema: "lm_staging", table: "sgu_well_2b4b514f" }, [
      { name: "brunnsid", type: "character varying(32)", typname: "varchar" },
      { name: "geom", type: "geometry(Point,3006)", typname: "geometry" },
      { name: "updated", type: "timestamp with time zone", typname: "timestamptz" },
    ]);
    expect(sql).toContain('CAST(src."brunnsid" AS character varying(32)) AS "brunnsid"');
    expect(sql).toContain(`encode(ST_AsEWKB(src."geom"::geometry), 'hex') AS "geom"`);
    expect(sql).toContain(`to_char(src."updated" AT TIME ZONE 'UTC'`);
    expect(sql).toContain('FROM "lm_staging"."sgu_well_2b4b514f" src');
    expect(sql).toContain("encode(sha256(convert_to(to_jsonb(r)::text, 'UTF8')), 'hex')");
    expect(sql).toContain(`string_agg(h, '' ORDER BY h COLLATE "C")`);
    expect(sql).toContain(`ORDER BY b COLLATE "C"`);
  });

  it("refuses an empty column set", () => {
    expect(() => buildMaterializedDigestSql({ schema: "env", table: "sgu_well" }, [])).toThrow(/NO_COMMON_COLUMNS/);
  });
});

describe("retainOutgoingThenReplace: the PRES-05 gate before TRUNCATE", () => {
  it("outgoing version retained -> record written to CAS, THEN TRUNCATE + INSERT, under ACCESS EXCLUSIVE in one transaction", async () => {
    const db = retainedScenario();
    const store = new InMemoryArtifactRepository();
    const status = await retainOutgoingThenReplace({ db, repo: loggingRepo(db, store), target: TARGET, insertSql: INSERT_SQL });

    const recordId = retentionRecordId(TARGET, HASH_V1);
    expect(status).toMatchObject({ kind: "RETAINED", outcome: "RECORDED", created_retained_relation: false });
    expect(db.log).toEqual([
      "query:current-batch",
      "BEGIN",
      "lock:ACCESS EXCLUSIVE",
      "query:current-batch",
      "digest:env.sgu_well",
      "digest:lm_staging.sgu_well_2b4b514f",
      `cas:put:${recordId}`,
      "TRUNCATE",
      "INSERT",
      "COMMIT",
    ]);
    const record = await store.resolve<SpatialDatasetRetentionRecord>({ artifact_id: recordId, artifact_type: SPATIAL_DATASET_RETENTION_RECORD });
    expect(record.artifact_type).toBe(SPATIAL_DATASET_RETENTION_RECORD);
    expect(record.payload).toMatchObject({
      contract_version: "spatial-dataset-retention-v2",
      target: TARGET,
      content_bundle_sha256: HASH_V1,
      import_batch_id: "batch-v1",
      dataset_version_label: "label-batch-v1",
      retained_relation: "lm_staging.sgu_well_2b4b514f",
      columns: ["brunnsid", "geom"],
      column_types: { brunnsid: "character varying(32)", geom: "geometry(Point,3006)" },
      row_count: 831332,
      digest: { algorithm: MATERIALIZED_DIGEST_V1, value: D_V1.digest },
    });
    expect(record.payload.engine_fingerprint).toEqual({ postgis: "3.4.3", geos: "3.9.0", proj: "7.2.1", gdal: "3.2.2" });
  });

  it("retained relation missing -> CTAS copy of live in its own committed SHARE-locked transaction, then the gate", async () => {
    const db = retainedScenario();
    db.tables.delete("lm_staging.sgu_well_2b4b514f");
    const status = await retainOutgoingThenReplace({ db, repo: loggingRepo(db), target: TARGET, insertSql: INSERT_SQL });

    expect(status).toMatchObject({ kind: "RETAINED", outcome: "RECORDED", created_retained_relation: true });
    expect(db.log.slice(0, 6)).toEqual(["query:current-batch", "BEGIN", "lock:SHARE", "create-schema", "ctas:lm_staging.sgu_well_2b4b514f", "COMMIT"]);
    expect(db.log.indexOf("TRUNCATE")).toBeGreaterThan(db.log.findIndex((e) => e.startsWith("cas:put:")));
  });

  it("digest differs -> REJECT_PROMOTE_OUTGOING_VERSION_NOT_RETAINED, rolled back, TRUNCATE never called, no record", async () => {
    const db = retainedScenario();
    db.tables.set("lm_staging.sgu_well_2b4b514f", { columns: STAGING_COLUMNS, digest: D_OTHER });
    const store = new InMemoryArtifactRepository();

    const error = await rejection(retainOutgoingThenReplace({ db, repo: loggingRepo(db, store), target: TARGET, insertSql: INSERT_SQL }));

    expect(error.code).toBe(REJECT_PROMOTE_OUTGOING_VERSION_NOT_RETAINED);
    expect(error.reason).toBe("DIGEST_MISMATCH");
    expect(db.log).not.toContain("TRUNCATE");
    expect(db.log).not.toContain("INSERT");
    expect(db.log[db.log.length - 1]).toBe("ROLLBACK");
    expect(db.log.some((e) => e.startsWith("cas:put:"))).toBe(false);
    expect(await resolveRetentionRecord(store, TARGET, HASH_V1)).toBeNull();
  });

  it("row count differs -> REJECT, no TRUNCATE", async () => {
    const db = retainedScenario();
    db.tables.set("lm_staging.sgu_well_2b4b514f", { columns: STAGING_COLUMNS, digest: { row_count: 1, digest: D_V1.digest } });
    const error = await rejection(retainOutgoingThenReplace({ db, repo: loggingRepo(db), target: TARGET, insertSql: INSERT_SQL }));
    expect(error.reason).toBe("DIGEST_MISMATCH");
    expect(db.log).not.toContain("TRUNCATE");
  });

  it("CAS write fails -> REJECT CAS_UNAVAILABLE, no TRUNCATE", async () => {
    const db = retainedScenario();
    const error = await rejection(retainOutgoingThenReplace({ db, repo: failingRepo("put"), target: TARGET, insertSql: INSERT_SQL }));
    expect(error.code).toBe(REJECT_PROMOTE_OUTGOING_VERSION_NOT_RETAINED);
    expect(error.reason).toBe("CAS_UNAVAILABLE");
    expect(db.log).not.toContain("TRUNCATE");
  });

  it("CAS read fails (not 'not found') -> REJECT CAS_UNAVAILABLE, never treated as 'no record yet'", async () => {
    const db = retainedScenario();
    const error = await rejection(retainOutgoingThenReplace({ db, repo: failingRepo("resolve"), target: TARGET, insertSql: INSERT_SQL }));
    expect(error.reason).toBe("CAS_UNAVAILABLE");
    expect(db.log).not.toContain("TRUNCATE");
  });

  it("record already stored with the same materialisation -> ALREADY_RECORDED, not rewritten, replace proceeds", async () => {
    const db = retainedScenario();
    const store = new InMemoryArtifactRepository();
    await retainOutgoingThenReplace({ db: retainedScenario(), repo: store, target: TARGET, insertSql: INSERT_SQL });

    const status = await retainOutgoingThenReplace({ db, repo: loggingRepo(db, store), target: TARGET, insertSql: INSERT_SQL });
    expect(status).toMatchObject({ kind: "RETAINED", outcome: "ALREADY_RECORDED" });
    expect(db.log.some((e) => e.startsWith("cas:put:"))).toBe(false);
    expect(db.log).toContain("TRUNCATE");
  });

  it("record already stored with a DIFFERENT digest -> REJECT RECORD_CONFLICT (WORM), no TRUNCATE", async () => {
    const store = new InMemoryArtifactRepository();
    await retainOutgoingThenReplace({ db: retainedScenario(), repo: store, target: TARGET, insertSql: INSERT_SQL });

    const db = retainedScenario();
    const changed = { row_count: 831332, digest: "e".repeat(64) };
    db.tables.set("env.sgu_well", { columns: LIVE_COLUMNS, digest: changed });
    db.tables.set("lm_staging.sgu_well_2b4b514f", { columns: STAGING_COLUMNS, digest: changed });
    const error = await rejection(retainOutgoingThenReplace({ db, repo: loggingRepo(db, store), target: TARGET, insertSql: INSERT_SQL }));
    expect(error.reason).toBe("RECORD_CONFLICT");
    expect(db.log).not.toContain("TRUNCATE");
  });

  it("outgoing SUCCESS batch changes between the phases -> REJECT OUTGOING_VERSION_CHANGED, no TRUNCATE", async () => {
    const db = retainedScenario();
    db.currentBatchOverride = { onCall: 2, row: batch("batch-concurrent", HASH_V2) };
    const error = await rejection(retainOutgoingThenReplace({ db, repo: loggingRepo(db), target: TARGET, insertSql: INSERT_SQL }));
    expect(error.reason).toBe("OUTGOING_VERSION_CHANGED");
    expect(db.log).not.toContain("TRUNCATE");
  });

  it("database error while digesting -> REJECT DATABASE_ERROR, no TRUNCATE", async () => {
    const db = retainedScenario();
    db.failOn = /^WITH row_hashes/;
    const error = await rejection(retainOutgoingThenReplace({ db, repo: loggingRepo(db), target: TARGET, insertSql: INSERT_SQL }));
    expect(error.reason).toBe("DATABASE_ERROR");
    expect(db.log).not.toContain("TRUNCATE");
  });

  it("CTAS failure in phase A -> REJECT, no TRUNCATE", async () => {
    const db = retainedScenario();
    db.tables.delete("lm_staging.sgu_well_2b4b514f");
    db.failOn = /^CREATE TABLE/;
    const error = await rejection(retainOutgoingThenReplace({ db, repo: loggingRepo(db), target: TARGET, insertSql: INSERT_SQL }));
    expect(error.code).toBe(REJECT_PROMOTE_OUTGOING_VERSION_NOT_RETAINED);
    expect(db.log).not.toContain("TRUNCATE");
  });

  it("F5: no SUCCESS batch while live holds rows -> REJECT NO_SUCCESS_BATCH_FOR_LIVE_DATA, no TRUNCATE, no promotion", async () => {
    const db = retainedScenario();
    db.successBatches = [];
    const error = await rejection(retainOutgoingThenReplace({ db, repo: loggingRepo(db), target: TARGET, insertSql: INSERT_SQL }));
    expect(error.code).toBe(REJECT_PROMOTE_OUTGOING_VERSION_NOT_RETAINED);
    expect(error.reason).toBe("NO_SUCCESS_BATCH_FOR_LIVE_DATA");
    expect(db.log).not.toContain("TRUNCATE");
    expect(db.log).not.toContain("INSERT");
  });

  it("F5: a CAS retention record for the live version never stands in for the missing SUCCESS batch", async () => {
    const store = new InMemoryArtifactRepository();
    await retainOutgoingThenReplace({ db: retainedScenario(), repo: store, target: TARGET, insertSql: INSERT_SQL });
    expect(await resolveRetentionRecord(store, TARGET, HASH_V1)).not.toBeNull();

    const db = retainedScenario();
    db.successBatches = []; // the ledger lost its SUCCESS rows; CAS still records v1
    const error = await rejection(retainOutgoingThenReplace({ db, repo: loggingRepo(db, store), target: TARGET, insertSql: INSERT_SQL }));
    expect(error.reason).toBe("NO_SUCCESS_BATCH_FOR_LIVE_DATA");
    expect(db.log).not.toContain("TRUNCATE");
  });

  it("F5: first import (no SUCCESS batch, live table empty) proceeds, the emptiness re-checked under the exclusive lock", async () => {
    const db = retainedScenario();
    db.successBatches = [];
    db.tables.set("env.sgu_well", { columns: LIVE_COLUMNS, digest: { row_count: 0, digest: "0".repeat(64) } });
    const status = await retainOutgoingThenReplace({ db, repo: loggingRepo(db), target: TARGET, insertSql: INSERT_SQL });
    expect(status).toEqual({ kind: "FIRST_IMPORT_EMPTY_LIVE" });
    expect(db.log).toEqual([
      "query:current-batch",
      "has-rows:env.sgu_well",
      "BEGIN",
      "lock:ACCESS EXCLUSIVE",
      "query:current-batch",
      "has-rows:env.sgu_well",
      "TRUNCATE",
      "INSERT",
      "COMMIT",
    ]);
  });

  it("F5: rows appearing in an empty live table between the phases -> REJECT, no TRUNCATE", async () => {
    const db = retainedScenario();
    db.successBatches = [];
    db.tables.set("env.sgu_well", { columns: LIVE_COLUMNS, digest: { row_count: 0, digest: "0".repeat(64) } });
    db.hasRowsOverride = { onCall: 2, value: true };
    const error = await rejection(retainOutgoingThenReplace({ db, repo: loggingRepo(db), target: TARGET, insertSql: INSERT_SQL }));
    expect(error.reason).toBe("NO_SUCCESS_BATCH_FOR_LIVE_DATA");
    expect(db.log).not.toContain("TRUNCATE");
    expect(db.log[db.log.length - 1]).toBe("ROLLBACK");
  });
});

describe("recordRetentionAtPromote: retention of the incoming version from birth", () => {
  function promotedScenario(stagingDigest: MaterializedDigest): FakeDb {
    const db = new FakeDb();
    db.tables.set("env.sgu_well", { columns: LIVE_COLUMNS, digest: D_OTHER });
    db.tables.set("lm_staging.sgu_well_aaaabbbb", { columns: STAGING_COLUMNS, digest: stagingDigest });
    return db;
  }

  it("staging relation equal to the promoted live table -> RECORDED for the incoming batch", async () => {
    const db = promotedScenario(D_OTHER);
    const store = new InMemoryArtifactRepository();
    const result = await recordRetentionAtPromote({ db, repo: store, target: TARGET, incoming: batch("batch-v2", HASH_V2) });
    expect(result.outcome).toBe("RECORDED");
    expect(result.record.payload).toMatchObject({ import_batch_id: "batch-v2", retained_relation: "lm_staging.sgu_well_aaaabbbb" });
    expect(await resolveRetentionRecord(store, TARGET, HASH_V2)).not.toBeNull();
  });

  it("staging differs from the promoted live table -> SPATIAL_DATASET_RETENTION_FAILED, no record", async () => {
    const db = promotedScenario(D_V1);
    const store = new InMemoryArtifactRepository();
    const error = await rejection(recordRetentionAtPromote({ db, repo: store, target: TARGET, incoming: batch("batch-v2", HASH_V2) }));
    expect(error.code).toBe(SPATIAL_DATASET_RETENTION_FAILED);
    expect(error.reason).toBe("DIGEST_MISMATCH");
    expect(await resolveRetentionRecord(store, TARGET, HASH_V2)).toBeNull();
  });
});

describe("isRetainedRelationProtected (for a staging cleanup)", () => {
  it("true for the retained relation of a SUCCESS batch, false otherwise", async () => {
    const db = retainedScenario();
    expect(await isRetainedRelationProtected(db, { schema: "lm_staging", table: "sgu_well_2b4b514f" })).toBe(true);
    expect(await isRetainedRelationProtected(db, { schema: "lm_staging", table: "sgu_well_deadbeef" })).toBe(false);
    expect(await isRetainedRelationProtected(db, { schema: "env", table: "sgu_well_2b4b514f" })).toBe(false);
  });
});

describe("resolveRetentionRecord", () => {
  it("null only for a genuinely missing record; other read errors propagate", async () => {
    expect(await resolveRetentionRecord(new InMemoryArtifactRepository(), TARGET, HASH_V1)).toBeNull();
    await expect(resolveRetentionRecord(failingRepo("resolve"), TARGET, HASH_V1)).rejects.toThrow(/MIMERS_ARTIFACT_INDEX_READ_FAILED/);
  });
});

/** The record id the b740615b-era code derived (contract v1 namespace), computed here so this file runs against old code. */
function legacyV1RecordId(target: { schema: string; table: string }, sha256: string): string {
  const digest = createHash("sha256").update(`spatial-dataset-retention-v1\u0000${target.schema}.${target.table}\u0000${sha256}`, "utf8").digest("hex");
  return `spatial-dataset-retention-${digest.slice(0, 40)}`;
}

describe("F3 (U30F): a retention record is verified only on a comparison basis", () => {
  it("every record written by the replace gate states its basis: the batch, the version it binds, the live digest it equalled, the relation's origin", async () => {
    const db = retainedScenario();
    db.successBatches = [{ ...batch("batch-v1", HASH_V1), row_count: D_V1.row_count }];
    const store = new InMemoryArtifactRepository();
    await retainOutgoingThenReplace({ db, repo: store, target: TARGET, insertSql: INSERT_SQL });
    const record = (await resolveRetentionRecord(store, TARGET, HASH_V1))!;
    expect(record.payload).toMatchObject({
      contract_version: "spatial-dataset-retention-v2",
      import_batch_id: "batch-v1",
      basis: {
        kind: "LIVE_EQUALS_RETAINED",
        established_by: "REPLACE_OUTGOING",
        version_batch_id: "batch-v1",
        version_hash: HASH_V1,
        live_relation: "env.sgu_well",
        live_digest: { row_count: D_V1.row_count, value: D_V1.digest },
        ledger_row_count: D_V1.row_count,
        retained_relation_origin: "PRE_EXISTING_RELATION",
      },
    });
  });

  it("a CTAS copy made at replace says so (its equality with live is by construction, the version identity rests on the ledger)", async () => {
    const db = retainedScenario();
    db.tables.delete("lm_staging.sgu_well_2b4b514f");
    const store = new InMemoryArtifactRepository();
    await retainOutgoingThenReplace({ db, repo: store, target: TARGET, insertSql: INSERT_SQL });
    expect((await resolveRetentionRecord(store, TARGET, HASH_V1))!.payload.basis).toMatchObject({
      retained_relation_origin: "CTAS_FROM_LIVE_AT_REPLACE",
      ledger_row_count: null,
    });
  });

  it("the ledger's row count for the batch disagrees with the retained rows -> REJECT LEDGER_ROW_COUNT_MISMATCH, no record, no TRUNCATE", async () => {
    const db = retainedScenario();
    db.successBatches = [{ ...batch("batch-v1", HASH_V1), row_count: D_V1.row_count + 1 }];
    const store = new InMemoryArtifactRepository();
    const error = await rejection(retainOutgoingThenReplace({ db, repo: loggingRepo(db, store), target: TARGET, insertSql: INSERT_SQL }));
    expect(error.reason).toBe("LEDGER_ROW_COUNT_MISMATCH");
    expect(db.log).not.toContain("TRUNCATE");
    expect(db.log.some((e) => e.startsWith("cas:put:"))).toBe(false);
  });

  it("a stored record without a verified basis is a RECORD_CONFLICT, never ALREADY_RECORDED", async () => {
    const store = new InMemoryArtifactRepository();
    const id = retentionRecordId(TARGET, HASH_V1);
    const basisless = {
      artifact_id: id,
      artifact_type: SPATIAL_DATASET_RETENTION_RECORD,
      payload: {
        contract_version: "spatial-dataset-retention-v1",
        target: TARGET,
        content_bundle_sha256: HASH_V1,
        import_batch_id: "batch-v1",
        dataset_version_label: "label-batch-v1",
        retained_relation: "lm_staging.sgu_well_2b4b514f",
        columns: ["brunnsid", "geom"],
        column_types: { brunnsid: "character varying(32)", geom: "geometry(Point,3006)" },
        row_count: D_V1.row_count,
        digest: { algorithm: MATERIALIZED_DIGEST_V1, value: D_V1.digest },
      },
    };
    await store.put({ artifact_id: id, content_hash: sha256ContentHash(basisless), body: basisless });
    const db = retainedScenario();
    const error = await rejection(retainOutgoingThenReplace({ db, repo: store, target: TARGET, insertSql: INSERT_SQL }));
    expect(error.reason).toBe("RECORD_CONFLICT");
    expect(db.log).not.toContain("TRUNCATE");
  });

  it("a legacy (v1, basis-less) record is never read as the verified record: the gate writes its own", async () => {
    const store = new InMemoryArtifactRepository();
    const legacyId = legacyV1RecordId(TARGET, HASH_V1);
    const legacy = { artifact_id: legacyId, artifact_type: SPATIAL_DATASET_RETENTION_RECORD, payload: { contract_version: "spatial-dataset-retention-v1" } };
    await store.put({ artifact_id: legacyId, content_hash: sha256ContentHash(legacy), body: legacy });
    const status = await retainOutgoingThenReplace({ db: retainedScenario(), repo: store, target: TARGET, insertSql: INSERT_SQL });
    expect(status).toMatchObject({ kind: "RETAINED", outcome: "RECORDED" });
    expect(retentionRecordId(TARGET, HASH_V1)).not.toBe(legacyId);
  });

  it("backfill: a superseded version has no comparison basis -> UNVERIFIED_BASIS, never recorded, even with --execute", async () => {
    const db = new FakeDb();
    db.successBatches = [batch("batch-v2", HASH_V2), batch("batch-v1", HASH_V1)];
    db.tables.set("env.sgu_well", { columns: LIVE_COLUMNS, digest: D_OTHER });
    db.tables.set("lm_staging.sgu_well_aaaabbbb", { columns: STAGING_COLUMNS, digest: D_OTHER });
    // The verifier's case: the superseded relation was manipulated; nothing can tell.
    db.tables.set("lm_staging.sgu_well_2b4b514f", { columns: STAGING_COLUMNS, digest: { row_count: 7, digest: "9".repeat(64) } });
    const store = new InMemoryArtifactRepository();
    const results = await backfillSpatialDatasetRetention({ db, repo: loggingRepo(db, store), targets: [TARGET], execute: true });
    expect(results.map((r) => [r.content_bundle_sha256, r.current, r.status])).toEqual([
      [HASH_V2, true, "RECORDED"],
      [HASH_V1, false, "UNVERIFIED_BASIS"],
    ]);
    expect(await resolveRetentionRecord(store, TARGET, HASH_V1)).toBeNull();
    expect(db.log).not.toContain("digest:lm_staging.sgu_well_2b4b514f");
    expect((await resolveRetentionRecord(store, TARGET, HASH_V2))!.payload.basis).toMatchObject({
      kind: "LIVE_EQUALS_RETAINED",
      established_by: "BACKFILL_CURRENT",
      version_batch_id: "batch-v2",
    });
  });
});

describe("F4 (U30F): the property layer's digest time is a hard precondition", () => {
  const PROPERTY = { schema: "env", table: "registerenhetsomradesytor" } as const;
  const HASH_P = "7aff5455" + "0".repeat(56);

  function propertyScenario(): FakeDb {
    const db = new FakeDb();
    db.successBatches = [batch("batch-p", HASH_P)];
    db.tables.set("env.registerenhetsomradesytor", { columns: LIVE_COLUMNS, digest: D_V1 });
    db.tables.set("lm_staging.registerenhetsomradesytor_7aff5455", { columns: STAGING_COLUMNS, digest: D_V1 });
    return db;
  }

  it("a replace promote of env.registerenhetsomradesytor is refused before any statement while its digest time is unmeasured", async () => {
    const db = propertyScenario();
    const error = await rejection(
      retainOutgoingThenReplace({ db, repo: loggingRepo(db), target: PROPERTY, insertSql: "INSERT INTO env.registerenhetsomradesytor SELECT 1" }),
    );
    expect(error.code).toBe(REJECT_PROMOTE_OUTGOING_VERSION_NOT_RETAINED);
    expect(error.reason).toBe("DIGEST_TIME_PRECONDITION_UNMET");
    expect(error.message).toContain("REJECT_RETENTION_DIGEST_TIME_UNMEASURED");
    expect(db.log).toEqual([]);
  });

  it("the backfill reports PRECONDITION_UNMET for every version of the property layer and digests nothing", async () => {
    const db = propertyScenario();
    const results = await backfillSpatialDatasetRetention({ db, repo: null, targets: [PROPERTY], execute: false });
    expect(results.map((r) => [r.content_bundle_sha256, r.status])).toEqual([[HASH_P, "PRECONDITION_UNMET"]]);
    expect(db.log.filter((e) => e.startsWith("digest:"))).toEqual([]);
  });

  it("the measurement times live and the current version's retained relation, read-only, and records nothing", async () => {
    const db = propertyScenario();
    let clock = 0;
    const steps = [0, 400_000, 400_000, 650_000];
    const results = await measureRetentionDigestTimes({ db, targets: [PROPERTY], now: () => (clock = steps.shift() ?? clock) });
    expect(results).toEqual([
      {
        target: "env.registerenhetsomradesytor",
        current_batch_id: "batch-p",
        live: { rows: D_V1.row_count, seconds: 400 },
        retained: { relation: "lm_staging.registerenhetsomradesytor_7aff5455", rows: D_V1.row_count, seconds: 250 },
        measured_digest_seconds: 400,
      },
    ]);
    expect(db.log.filter((e) => /^(BEGIN|lock|ctas|create|TRUNCATE|INSERT|cas:)/.test(e))).toEqual([]);
  });

  it("a target that is not named in the preconditions is unaffected", async () => {
    const status = await retainOutgoingThenReplace({ db: retainedScenario(), repo: new InMemoryArtifactRepository(), target: TARGET, insertSql: INSERT_SQL });
    expect(status.kind).toBe("RETAINED");
  });
});

describe("backfillSpatialDatasetRetention (ops CLI core): read-only DB, CAS only on execute", () => {
  function backfillScenario(): FakeDb {
    const db = new FakeDb();
    db.successBatches = [batch("batch-v2", HASH_V2), batch("batch-v1", HASH_V1), batch("batch-v1-dup", HASH_V1)];
    db.tables.set("env.sgu_well", { columns: LIVE_COLUMNS, digest: D_OTHER });
    db.tables.set("lm_staging.sgu_well_aaaabbbb", { columns: STAGING_COLUMNS, digest: D_OTHER });
    db.tables.set("lm_staging.sgu_well_2b4b514f", { columns: STAGING_COLUMNS, digest: D_V1 });
    return db;
  }

  it("plan mode: one result per version, WOULD_RECORD for the current one, UNVERIFIED_BASIS for the superseded one (F3), no statement other than reads, no CAS", async () => {
    const db = backfillScenario();
    const results = await backfillSpatialDatasetRetention({ db, repo: null, targets: [TARGET], execute: false });
    expect(results.map((r) => [r.content_bundle_sha256, r.current, r.status])).toEqual([
      [HASH_V2, true, "WOULD_RECORD"],
      [HASH_V1, false, "UNVERIFIED_BASIS"],
    ]);
    expect(db.log.filter((e) => /^(BEGIN|lock|ctas|create|TRUNCATE|INSERT|cas:)/.test(e))).toEqual([]);
  });

  it("execute: the current version RECORDED, then ALREADY_RECORDED; the superseded one never recorded", async () => {
    const store = new InMemoryArtifactRepository();
    const first = await backfillSpatialDatasetRetention({ db: backfillScenario(), repo: store, targets: [TARGET], execute: true });
    expect(first.map((r) => r.status)).toEqual(["RECORDED", "UNVERIFIED_BASIS"]);
    const second = await backfillSpatialDatasetRetention({ db: backfillScenario(), repo: store, targets: [TARGET], execute: true });
    expect(second.map((r) => r.status)).toEqual(["ALREADY_RECORDED", "UNVERIFIED_BASIS"]);
  });

  it("a replaced version whose relation is gone is reported NOT_RETAINED, never invented", async () => {
    const db = backfillScenario();
    db.tables.delete("lm_staging.sgu_well_2b4b514f");
    const results = await backfillSpatialDatasetRetention({ db, repo: null, targets: [TARGET], execute: false });
    expect(results[1]).toMatchObject({ content_bundle_sha256: HASH_V1, status: "NOT_RETAINED_RELATION_MISSING" });
    expect(db.log).not.toContain("ctas:lm_staging.sgu_well_2b4b514f");
  });

  it("the current version is recorded only if retained digest = live digest", async () => {
    const db = backfillScenario();
    db.tables.set("lm_staging.sgu_well_aaaabbbb", { columns: STAGING_COLUMNS, digest: D_V1 });
    const store = new InMemoryArtifactRepository();
    const results = await backfillSpatialDatasetRetention({ db, repo: store, targets: [TARGET], execute: true });
    expect(results[0]).toMatchObject({ current: true, status: "DIGEST_MISMATCH" });
    expect(await resolveRetentionRecord(store, TARGET, HASH_V2)).toBeNull();
  });

  it("--execute without a CAS is refused", async () => {
    await expect(backfillSpatialDatasetRetention({ db: backfillScenario(), repo: null, targets: [TARGET], execute: true })).rejects.toThrow(
      /CAS_UNAVAILABLE/,
    );
  });
});
