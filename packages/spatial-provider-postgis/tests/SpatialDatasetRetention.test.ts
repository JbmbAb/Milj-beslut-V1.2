import { describe, expect, it } from "vitest";
import { InMemoryArtifactRepository } from "../../mps-runtime/src/repository/InMemoryArtifactRepository";
import type { ArtifactRepositoryPort } from "../../mps-runtime/src/kernel/ExecutionKernel";
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
  private currentLookups = 0;

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
      contract_version: "spatial-dataset-retention-v1",
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

  it("no SUCCESS batch for the target (nothing governed, nothing bindable) -> replace proceeds without a record", async () => {
    const db = retainedScenario();
    db.successBatches = [];
    const status = await retainOutgoingThenReplace({ db, repo: loggingRepo(db), target: TARGET, insertSql: INSERT_SQL });
    expect(status).toEqual({ kind: "NO_GOVERNED_OUTGOING_VERSION" });
    expect(db.log).toEqual(["query:current-batch", "BEGIN", "lock:ACCESS EXCLUSIVE", "query:current-batch", "TRUNCATE", "INSERT", "COMMIT"]);
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

describe("backfillSpatialDatasetRetention (ops CLI core): read-only DB, CAS only on execute", () => {
  function backfillScenario(): FakeDb {
    const db = new FakeDb();
    db.successBatches = [batch("batch-v2", HASH_V2), batch("batch-v1", HASH_V1), batch("batch-v1-dup", HASH_V1)];
    db.tables.set("env.sgu_well", { columns: LIVE_COLUMNS, digest: D_OTHER });
    db.tables.set("lm_staging.sgu_well_aaaabbbb", { columns: STAGING_COLUMNS, digest: D_OTHER });
    db.tables.set("lm_staging.sgu_well_2b4b514f", { columns: STAGING_COLUMNS, digest: D_V1 });
    return db;
  }

  it("plan mode: one result per version, WOULD_RECORD, no statement other than reads, no CAS", async () => {
    const db = backfillScenario();
    const results = await backfillSpatialDatasetRetention({ db, repo: null, targets: [TARGET], execute: false });
    expect(results.map((r) => [r.content_bundle_sha256, r.current, r.status])).toEqual([
      [HASH_V2, true, "WOULD_RECORD"],
      [HASH_V1, false, "WOULD_RECORD"],
    ]);
    expect(db.log.filter((e) => /^(BEGIN|lock|ctas|create|TRUNCATE|INSERT|cas:)/.test(e))).toEqual([]);
  });

  it("execute: RECORDED, then ALREADY_RECORDED on a second run", async () => {
    const store = new InMemoryArtifactRepository();
    const first = await backfillSpatialDatasetRetention({ db: backfillScenario(), repo: store, targets: [TARGET], execute: true });
    expect(first.map((r) => r.status)).toEqual(["RECORDED", "RECORDED"]);
    const second = await backfillSpatialDatasetRetention({ db: backfillScenario(), repo: store, targets: [TARGET], execute: true });
    expect(second.map((r) => r.status)).toEqual(["ALREADY_RECORDED", "ALREADY_RECORDED"]);
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
