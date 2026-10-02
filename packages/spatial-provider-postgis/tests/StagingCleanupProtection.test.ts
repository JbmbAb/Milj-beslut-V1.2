import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { InMemoryArtifactRepository } from "../../mps-runtime/src/repository/InMemoryArtifactRepository";
import { sha256ContentHash } from "../../mps-runtime/src/kernel/ExecutionKernel";
import type { ArtifactRepositoryPort } from "../../mps-runtime/src/kernel/ExecutionKernel";
import { retentionRecordId, type SqlPort } from "../src/SpatialDatasetRetention";
import {
  CLEANUP_SKIPPED_PROTECTION_UNVERIFIABLE,
  CLEANUP_SKIPPED_RETAINED_RELATION,
  planStagingCleanup,
  quoteStagingRelation,
  type StagingCleanupCandidate,
} from "../src/StagingCleanupProtection";

/**
 * U30-B2 cleanup-staging: the planner decides keep/drop per relation before any DROP. Hermetic:
 * a scripted SQL port answers only the SUCCESS-batch protection query; the CAS is in memory.
 */
const H1 = "1111111111111111111111111111111111111111111111111111111111111111";
const H2 = "2222222222222222222222222222222222222222222222222222222222222222";
const H3 = "3333333333333333333333333333333333333333333333333333333333333333";

function db(successRelations: readonly string[]): SqlPort & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async query<T>(sql: string, params: readonly unknown[] = []) {
      // U30F2 M3: the planner looks for a candidate's current (24 hex) relation first; none exists here.
      if (sql.includes("to_regclass")) return { rows: [{ exists: false }] as T[] };
      if (!sql.includes('FROM "PostgisImportBatch"')) throw new Error(`unexpected query ${sql}`);
      const name = String(params[0]);
      calls.push(name);
      if (sql.includes("EXISTS")) return { rows: [{ protected: successRelations.includes(name) }] as T[] };
      // U30F: the full per-relation ledger read
      return {
        rows: (successRelations.includes(name)
          ? [{ id: `success-${name}`, status: "SUCCESS", target_schema: "env", target_table: name.replace(/_[0-9a-f]{8}$/, ""), content_bundle_sha256: H1, started_at: null }]
          : []) as T[],
      };
    },
    async execute() {
      throw new Error("the planner never executes a statement");
    },
  };
}

function candidate(id: string, table: string, hash: string, status = "FAILED"): StagingCleanupCandidate {
  return { id, status, target_schema: "env", target_table: table, content_bundle_sha256: hash };
}

async function repoWithRecordFor(table: string, hash: string): Promise<ArtifactRepositoryPort> {
  const repo = new InMemoryArtifactRepository();
  const target = { schema: "env", table };
  const body = { artifact_id: retentionRecordId(target, hash), payload: { target } };
  await repo.put({ artifact_id: body.artifact_id, content_hash: sha256ContentHash(body), body });
  return repo;
}

describe("planStagingCleanup (U30-B2 cleanup-staging)", () => {
  it("one decision per relation (FAILED rows of the same version are grouped), sorted, no statement executed", async () => {
    const port = db(["sgu_well_11111111"]);
    const decisions = await planStagingCleanup({
      db: port,
      repo: new InMemoryArtifactRepository(),
      candidates: [candidate("a", "sgu_well", H1), candidate("b", "sgu_well", H1), candidate("c", "ebh", H2)],
    });
    expect(decisions).toEqual([
      { action: "DROP", relation: { schema: "lm_staging", table: "ebh_22222222" }, relation_name: "lm_staging.ebh_22222222", batch_ids: ["c"] },
      {
        action: "SKIP",
        code: CLEANUP_SKIPPED_RETAINED_RELATION,
        reason: "SUCCESS_BATCH",
        relation: { schema: "lm_staging", table: "sgu_well_11111111" },
        relation_name: "lm_staging.sgu_well_11111111",
        batch_ids: ["a", "b"],
        detail: "SUCCESS batch success-sgu_well_11111111 is materialised in it",
      },
    ]);
    expect(port.calls).toEqual(["ebh_22222222", "sgu_well_11111111"]);
  });

  it("a retention record for the version protects the relation even without a SUCCESS batch", async () => {
    const decisions = await planStagingCleanup({ db: db([]), repo: await repoWithRecordFor("ebh", H2), candidates: [candidate("c", "ebh", H2)] });
    expect(decisions[0]).toMatchObject({ action: "SKIP", code: CLEANUP_SKIPPED_RETAINED_RELATION, reason: "RETENTION_RECORD", record_id: retentionRecordId({ schema: "env", table: "ebh" }, H2) });
  });

  it("CAS unavailable or unreadable -> kept as unverifiable, never dropped", async () => {
    const noCas = await planStagingCleanup({ db: db([]), repo: null, candidates: [candidate("c", "ebh", H2)] });
    expect(noCas[0]).toMatchObject({ action: "SKIP", code: CLEANUP_SKIPPED_PROTECTION_UNVERIFIABLE });
    const unreadable: ArtifactRepositoryPort = {
      put: async () => undefined,
      resolve: async () => {
        throw new Error("MIMERS_ARTIFACT_INDEX_READ_FAILED: simulated");
      },
    };
    const broken = await planStagingCleanup({ db: db([]), repo: unreadable, candidates: [candidate("c", "ebh", H3)] });
    expect(broken[0]).toMatchObject({ action: "SKIP", code: CLEANUP_SKIPPED_PROTECTION_UNVERIFIABLE });
    expect((broken[0] as { detail: string }).detail).toContain("MIMERS_ARTIFACT_INDEX_READ_FAILED");
  });

  it("an 8-hex collision is protected if ANY version behind the relation has a record", async () => {
    const colliding = "11111111" + "9".repeat(56);
    const decisions = await planStagingCleanup({
      db: db([]),
      repo: await repoWithRecordFor("sgu_well", colliding),
      candidates: [candidate("a", "sgu_well", H1), candidate("b", "sgu_well", colliding)],
    });
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({ action: "SKIP", reason: "RETENTION_RECORD", batch_ids: ["a", "b"] });
  });

  it("a non-identifier relation name is never planned as a DROP, and the quoting refuses it", async () => {
    const decisions = await planStagingCleanup({ db: db([]), repo: new InMemoryArtifactRepository(), candidates: [candidate("x", 'sgu"; drop', H1)] });
    expect(decisions[0]).toMatchObject({ action: "SKIP", code: CLEANUP_SKIPPED_PROTECTION_UNVERIFIABLE });
    expect(() => quoteStagingRelation({ schema: "lm_staging", table: 'x"; drop' })).toThrow(/REJECT_STAGING_CLEANUP_IDENTIFIER/);
    expect(quoteStagingRelation({ schema: "lm_staging", table: "sgu_well_11111111" })).toBe('"lm_staging"."sgu_well_11111111"');
  });

  it("a database error while checking the ledger propagates (the cleanup stops before any drop)", async () => {
    const failing: SqlPort = {
      query: async () => {
        throw new Error("simulated database failure");
      },
      execute: async () => undefined,
    };
    await expect(planStagingCleanup({ db: failing, repo: null, candidates: [candidate("a", "sgu_well", H1)] })).rejects.toThrow(/simulated/);
  });
});

// ---------------------------------------------------------------------------------------------
// U30F F9 / F1: protection is decided per relation from the WHOLE ledger and from CAS by the
// relation's own name, so a missing SUCCESS row or an 8-hex collision never opens a DROP.
// ---------------------------------------------------------------------------------------------

type LedgerRow = { id: string; status: string; target_schema: string; target_table: string; content_bundle_sha256: string; started_at: Date };

/**
 * A ledger fake that answers both the SUCCESS-only EXISTS probe and a full per-relation ledger read,
 * matching a relation name under both naming schemes (U30F2 M3), and `to_regclass` for `existing`.
 */
function ledgerDb(rows: LedgerRow[], existing: readonly string[] = []): SqlPort & { statements: string[]; queries: string[] } {
  const statements: string[] = [];
  const queries: string[] = [];
  const namesOf = (r: LedgerRow) => [8, 24].map((n) => `${r.target_table}_${r.content_bundle_sha256.substring(0, n)}`);
  return {
    statements,
    queries,
    async query<T>(sql: string, params: readonly unknown[] = []) {
      const s = sql.replace(/\s+/g, " ").trim();
      queries.push(s);
      if (s.startsWith("SELECT to_regclass")) return { rows: [{ exists: existing.includes(String(params[0]).replace(/"/g, "")) }] as T[] };
      if (!s.includes('FROM "PostgisImportBatch"')) throw new Error(`unexpected query ${s}`);
      const name = String(params[0]);
      if (s.includes("EXISTS")) return { rows: [{ protected: rows.some((r) => r.status === "SUCCESS" && namesOf(r).includes(name)) }] as T[] };
      return { rows: rows.filter((r) => namesOf(r).includes(name)) as T[] };
    },
    async execute(sql: string) {
      statements.push(sql);
    },
  };
}

function claimId(relation: string): string {
  const digest = createHash("sha256").update(`spatial-dataset-retained-relation-claim-v1\u0000${relation}`, "utf8").digest("hex");
  return `spatial-dataset-retained-relation-claim-${digest.slice(0, 40)}`;
}

function legacyV1Id(table: string, hash: string): string {
  const digest = createHash("sha256").update(`spatial-dataset-retention-v1\u0000env.${table}\u0000${hash}`, "utf8").digest("hex");
  return `spatial-dataset-retention-${digest.slice(0, 40)}`;
}

async function put(repo: InMemoryArtifactRepository, id: string, payload: Record<string, unknown>): Promise<void> {
  const body = { artifact_id: id, payload };
  await repo.put({ artifact_id: id, content_hash: sha256ContentHash(body), body });
}

const V = "2b4b514f" + "a".repeat(56);
const V2 = "2b4b514f" + "b".repeat(56); // same 8-hex prefix: the same relation name
const NOW = new Date("2026-10-02T20:00:00Z");

function row(id: string, status: string, hash: string, startedHoursAgo = 48): LedgerRow {
  return { id, status, target_schema: "env", target_table: "sgu_well", content_bundle_sha256: hash, started_at: new Date(NOW.getTime() - startedHoursAgo * 3600_000) };
}

describe("U30F F9: per-relation protection without the SUCCESS row", () => {
  it("8-hex collision: V's SUCCESS row is gone but V's relation claim is in CAS -> the FAILED V2 batch never drops it", async () => {
    const repo = new InMemoryArtifactRepository();
    await put(repo, claimId("lm_staging.sgu_well_2b4b514f"), { retained_relation: "lm_staging.sgu_well_2b4b514f", content_bundle_sha256: V });
    const decisions = await planStagingCleanup({ db: ledgerDb([row("v2-failed", "FAILED", V2)]), repo, candidates: [candidate("v2-failed", "sgu_well", V2)] });
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({ action: "SKIP", code: CLEANUP_SKIPPED_RETAINED_RELATION, reason: "RETENTION_CLAIM" });
  });

  it("a record for ANY ledger version behind the relation protects it (not only the candidates' versions), legacy v1 records included", async () => {
    const repo = new InMemoryArtifactRepository();
    await put(repo, legacyV1Id("sgu_well", V), { contract_version: "spatial-dataset-retention-v1" });
    const ledger = [row("v-failed", "FAILED", V), row("v2-failed", "FAILED", V2)];
    const decisions = await planStagingCleanup({ db: ledgerDb(ledger), repo, candidates: [candidate("v2-failed", "sgu_well", V2)] });
    expect(decisions[0]).toMatchObject({ action: "SKIP", code: CLEANUP_SKIPPED_RETAINED_RELATION, reason: "LEGACY_RETENTION_RECORD" });
  });

  it("an in-flight batch of the relation (STAGING_IMPORTED / PROMOTE_STARTED / fresh STAGING_STARTED) keeps it", async () => {
    for (const status of ["STAGING_IMPORTED", "PROMOTE_STARTED"]) {
      const ledger = [row("v-failed", "FAILED", V), row("v-live", status, V)];
      const decisions = await planStagingCleanup({ db: ledgerDb(ledger), repo: new InMemoryArtifactRepository(), candidates: [candidate("v-failed", "sgu_well", V)], now: NOW });
      expect(decisions[0], status).toMatchObject({ action: "SKIP", code: CLEANUP_SKIPPED_RETAINED_RELATION, reason: "IN_FLIGHT_BATCH" });
    }
    const fresh = [row("v-failed", "FAILED", V), row("v-start", "STAGING_STARTED", V, 2)];
    expect((await planStagingCleanup({ db: ledgerDb(fresh), repo: new InMemoryArtifactRepository(), candidates: [candidate("v-failed", "sgu_well", V)], now: NOW }))[0]).toMatchObject({
      action: "SKIP",
      reason: "IN_FLIGHT_BATCH",
    });
    const stale = [row("v-start", "STAGING_STARTED", V, 30)];
    expect((await planStagingCleanup({ db: ledgerDb(stale), repo: new InMemoryArtifactRepository(), candidates: [candidate("v-start", "sgu_well", V, "STAGING_STARTED")], now: NOW }))[0]).toMatchObject({
      action: "DROP",
    });
  });
});

describe("U30F2 M3: the planner and the per-relation protection know both naming schemes", () => {
  const V_V2 = "sgu_well_2b4b514faaaaaaaaaaaaaaaa"; // V's current (24 hex) relation name

  it("a candidate whose 24-hex relation exists (staged after the switch) is planned under that name", async () => {
    const ledger = [row("v-failed", "FAILED", V)];
    const decisions = await planStagingCleanup({ db: ledgerDb(ledger, [`lm_staging.${V_V2}`]), repo: new InMemoryArtifactRepository(), candidates: [candidate("v-failed", "sgu_well", V)], now: NOW });
    expect(decisions).toEqual([{ action: "DROP", relation: { schema: "lm_staging", table: V_V2 }, relation_name: `lm_staging.${V_V2}`, batch_ids: ["v-failed"] }]);
  });

  it("without a 24-hex relation the candidate's legacy 8-hex relation is planned (the 2026-10-02 database holds only those)", async () => {
    const decisions = await planStagingCleanup({ db: ledgerDb([row("v-failed", "FAILED", V)]), repo: new InMemoryArtifactRepository(), candidates: [candidate("v-failed", "sgu_well", V)], now: NOW });
    expect(decisions[0]).toMatchObject({ action: "DROP", relation_name: "lm_staging.sgu_well_2b4b514f" });
  });

  it("a 24-hex relation of a SUCCESS version is kept: the per-relation ledger read matches either name", async () => {
    const port = ledgerDb([row("v-ok", "SUCCESS", V), row("v-failed", "FAILED", V)], [`lm_staging.${V_V2}`]);
    const decisions = await planStagingCleanup({ db: port, repo: new InMemoryArtifactRepository(), candidates: [candidate("v-failed", "sgu_well", V)], now: NOW });
    expect(decisions[0]).toMatchObject({ action: "SKIP", code: CLEANUP_SKIPPED_RETAINED_RELATION, reason: "SUCCESS_BATCH", relation_name: `lm_staging.${V_V2}` });
    const ledgerRead = port.queries.find((q) => q.includes("started_at"))!;
    expect(ledgerRead).toContain("substr(content_bundle_sha256, 1, 24)");
    expect(ledgerRead).toContain("substr(content_bundle_sha256, 1, 8)");
  });
});
