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
      if (!sql.includes('FROM "PostgisImportBatch"')) throw new Error(`unexpected query ${sql}`);
      calls.push(String(params[0]));
      return { rows: [{ protected: successRelations.includes(String(params[0])) }] as T[] };
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

  it("a database error while checking SUCCESS batches propagates (the cleanup stops before any drop)", async () => {
    const failing: SqlPort = {
      query: async () => {
        throw new Error("simulated database failure");
      },
      execute: async () => undefined,
    };
    await expect(planStagingCleanup({ db: failing, repo: null, candidates: [candidate("a", "sgu_well", H1)] })).rejects.toThrow(/simulated/);
  });
});
