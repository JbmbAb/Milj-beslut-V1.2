/**
 * W-NO-GOOGLE-02A -- the explicit 3072 -> 1024 persistence boundary (RED first).
 *
 * A local 1024-dimensional embedding never touches the historical vector(3072) table. It has its
 * own versioned table whose database constraints pin the only two admitted local pipelines, and a
 * persistence function that refuses anything that is not exactly one of them before any SQL runs.
 * The historical Google rows stay untouched, are never read as local, and are never migrated.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const db = vi.hoisted(() => ({
  queryRawUnsafe: vi.fn(async (..._args: unknown[]) => [] as unknown[]),
}));

vi.mock("../../server/db/prisma", () => ({
  prisma: { $queryRawUnsafe: db.queryRawUnsafe },
}));

import {
  bindEmbeddingIdentity,
  bindLocalEmbeddingIdentity,
  EmbeddingIdentityError,
  LOCAL_EMBEDDING_PIPELINES,
} from "@miljobeslut/mps-embedding-identity";
import { EmbeddingProviderError } from "../../server/modules/legal/retrieval/EmbeddingProvider";
import {
  LOCAL_EMBEDDING_INSERT_SQL,
  LOCAL_EMBEDDING_TABLE,
  assertLocalQueryVector,
  buildPersistLocalEmbeddingStatement,
  persistLocalChunkEmbedding,
  toVectorLiteral,
} from "../../server/modules/legal/retrieval/LocalEmbeddingPersistence";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const CHUNK = { fragment_id: "frag:abc", materialization_id: "mat:1", chunk_content_hash: "hash:abc" } as const;
const IDENTITY = bindLocalEmbeddingIdentity(CHUNK, "bge-m3");
const GOOGLE_IDENTITY = bindEmbeddingIdentity({
  ...CHUNK,
  embedding_model_id: "gemini-embedding-001",
  embedding_model_version: "001",
  embedding_pipeline_version: "embed-pipeline-gemini-v1",
});

function vec(dim: number, hot = 0): number[] {
  const v = new Array<number>(dim).fill(0);
  v[hot] = 1;
  return v;
}

/** The historical table name, matched as a whole identifier (the local table name extends it). */
const LEGACY_TABLE_REF = /legal_corpus_chunk_embeddings(?!_local)/;

function git(args: string[]): string[] {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).split(/\r?\n/).filter(Boolean);
}

describe("buildPersistLocalEmbeddingStatement", () => {
  it("writes only to the versioned local table, never to the historical 3072 table", () => {
    const { sql } = buildPersistLocalEmbeddingStatement(IDENTITY, vec(1024));
    expect(LOCAL_EMBEDDING_TABLE).toBe("legal_corpus_chunk_embeddings_local_v1");
    expect(sql).toContain(`"${LOCAL_EMBEDDING_TABLE}"`);
    expect(sql).not.toMatch(LEGACY_TABLE_REF);
  });

  it("binds the identity fields and the explicit dimension, casts the vector to vector(1024)", () => {
    const { sql, params } = buildPersistLocalEmbeddingStatement(IDENTITY, vec(1024));
    expect(sql).toMatch(/\$\d+::vector\(1024\)/);
    expect(sql).toContain("embedding_dimension");
    expect(sql).toContain('ON CONFLICT ("embedding_identity_hash") DO NOTHING');
    expect(params).toContain(IDENTITY.embedding_identity_hash);
    expect(params).toContain(1024);
    expect(params.find((p) => typeof p === "string" && p.startsWith("["))).toBe(toVectorLiteral(vec(1024)));
  });

  it("rejects a 3072-dimensional vector (no truncation to 1024) before any SQL is built", () => {
    expect(() => buildPersistLocalEmbeddingStatement(IDENTITY, vec(3072))).toThrow(EmbeddingProviderError);
    try {
      buildPersistLocalEmbeddingStatement(IDENTITY, vec(3072));
    } catch (error) {
      expect((error as EmbeddingProviderError).code).toBe("EMBEDDING_DIMENSION_MISMATCH");
    }
  });

  it("rejects a short vector (no zero padding) and non-finite components", () => {
    expect(() => buildPersistLocalEmbeddingStatement(IDENTITY, vec(1023))).toThrow(EmbeddingProviderError);
    const bad = vec(1024);
    bad[5] = Number.POSITIVE_INFINITY;
    expect(() => buildPersistLocalEmbeddingStatement(IDENTITY, bad)).toThrow(EmbeddingProviderError);
  });

  it("rejects the historical Google identity: old vectors are never accepted under a local identity", () => {
    expect(() => buildPersistLocalEmbeddingStatement(GOOGLE_IDENTITY, vec(1024))).toThrow(EmbeddingIdentityError);
    expect(() => buildPersistLocalEmbeddingStatement(GOOGLE_IDENTITY, vec(3072))).toThrow();
  });

  it("rejects an identity whose fields were tampered after binding", () => {
    const tampered = { ...IDENTITY, embedding_model_version: "0".repeat(40) };
    expect(() => buildPersistLocalEmbeddingStatement(tampered, vec(1024))).toThrow();
  });
});

describe("persistLocalChunkEmbedding", () => {
  beforeEach(() => db.queryRawUnsafe.mockReset());

  it("runs exactly one statement, the pinned local insert, and reports an insert", async () => {
    db.queryRawUnsafe.mockResolvedValueOnce([{ id: "row-1" }]);
    const res = await persistLocalChunkEmbedding(IDENTITY, vec(1024));
    expect(db.queryRawUnsafe).toHaveBeenCalledTimes(1);
    expect(db.queryRawUnsafe.mock.calls[0]![0]).toBe(LOCAL_EMBEDDING_INSERT_SQL);
    expect(res).toEqual({ inserted: true, embedding_identity_hash: IDENTITY.embedding_identity_hash });
  });

  it("the insert statement is a plain literal naming exactly LOCAL_EMBEDDING_TABLE (readable by the write inventory)", () => {
    expect(LOCAL_EMBEDDING_INSERT_SQL).toContain(`INSERT INTO "${LOCAL_EMBEDDING_TABLE}"`);
    expect(LOCAL_EMBEDDING_INSERT_SQL).not.toContain("${");
    expect(LOCAL_EMBEDDING_INSERT_SQL).toContain("$9::vector(1024)");
  });

  it("reports an idempotent replay (ON CONFLICT DO NOTHING returns no row) as inserted=false", async () => {
    db.queryRawUnsafe.mockResolvedValueOnce([]);
    const res = await persistLocalChunkEmbedding(IDENTITY, vec(1024));
    expect(res.inserted).toBe(false);
  });

  it("never reaches the database for an invalid vector or identity", async () => {
    await expect(persistLocalChunkEmbedding(IDENTITY, vec(3072))).rejects.toThrow();
    await expect(persistLocalChunkEmbedding(GOOGLE_IDENTITY, vec(1024))).rejects.toThrow();
    expect(db.queryRawUnsafe).not.toHaveBeenCalled();
  });
});

describe("assertLocalQueryVector -- the read side of the same boundary", () => {
  const PIPELINE = IDENTITY.embedding_pipeline_version;

  it("accepts a finite 1024-dimensional vector for a registered local pipeline", () => {
    expect(() => assertLocalQueryVector(vec(1024), PIPELINE)).not.toThrow();
  });

  it("rejects a 3072-dimensional query vector instead of letting the database compare mixed dimensions", () => {
    expect(() => assertLocalQueryVector(vec(3072), PIPELINE)).toThrow(EmbeddingProviderError);
  });

  it("rejects a Google pipeline version", () => {
    expect(() => assertLocalQueryVector(vec(1024), "embed-pipeline-gemini-v1")).toThrow();
  });
});

describe("migration proposal for the local 1024 table (text contract; NOT applied here)", () => {
  const dirs = fs.readdirSync(path.join(ROOT, "prisma/migrations")).filter((d) => d.endsWith("_legal_corpus_chunk_embedding_local_v1"));

  it("exists as exactly one migration directory", () => {
    expect(dirs).toHaveLength(1);
  });

  const sql = dirs.length === 1 ? fs.readFileSync(path.join(ROOT, "prisma/migrations", dirs[0]!, "migration.sql"), "utf8") : "";
  const code = sql
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n");

  it("creates the versioned local table with a NOT NULL vector(1024) and no 3072 anywhere", () => {
    expect(code).toContain(`CREATE TABLE "${LOCAL_EMBEDDING_TABLE}"`);
    expect(code).toMatch(/"embedding_vector"\s+vector\(1024\)\s+NOT NULL/);
    expect(code).not.toContain("3072");
  });

  it("makes the dimension explicit and constrained", () => {
    expect(code).toMatch(/"embedding_dimension"\s+SMALLINT\s+NOT NULL/i);
    expect(code).toMatch(/CHECK\s*\(\s*"embedding_dimension"\s*=\s*1024\s*\)/);
  });

  it("keeps the identity hash unique and the same composite foreign key to the governed chunks", () => {
    expect(code).toMatch(/UNIQUE INDEX[^;]*"embedding_identity_hash"/i);
    expect(code).toMatch(/FOREIGN KEY \("materialization_id", "fragment_id"\)\s+REFERENCES "legal_corpus_materialized_chunks"/);
  });

  it("pins exactly the registered local pipelines at database level -- same values as the TypeScript registry", () => {
    for (const p of LOCAL_EMBEDDING_PIPELINES) {
      expect(code).toContain(`'${p.hf_repo}'`);
      expect(code).toContain(`'${p.hf_revision}'`);
      expect(code).toContain(`'${p.pipeline_version}'`);
    }
    const literals = new Set(code.match(/'local-st-[^']+'/g) ?? []);
    expect([...literals].sort()).toEqual(LOCAL_EMBEDDING_PIPELINES.map((p) => `'${p.pipeline_version}'`).sort());
    expect(code).not.toMatch(/gemini|google|embed-pipeline-gemini/i);
  });

  it("is schema-only: no data is copied, read, updated or deleted, and the historical table is not touched", () => {
    expect(code).not.toMatch(/\b(INSERT\s+INTO|UPDATE\s+"|DELETE\s+FROM|TRUNCATE|DROP\s+(TABLE|COLUMN|INDEX|CONSTRAINT))/i);
    expect(code).not.toMatch(LEGACY_TABLE_REF);
    expect(code).not.toMatch(/ALTER\s+TABLE\s+"legal_corpus_chunk_embeddings"/);
  });

  it("is mirrored by the Prisma schema, and the historical model is unchanged (still vector(3072))", () => {
    const schema = fs.readFileSync(path.join(ROOT, "prisma/schema.prisma"), "utf8");
    expect(schema).toMatch(/model LegalCorpusChunkEmbeddingLocalV1\s*\{/);
    expect(schema).toContain('Unsupported("vector(1024)")');
    expect(schema).toContain('@@map("legal_corpus_chunk_embeddings_local_v1")');
    const legacy = schema.slice(schema.indexOf("model LegalCorpusChunkEmbedding {"));
    expect(legacy.slice(0, legacy.indexOf("@@map(\"legal_corpus_chunk_embeddings\")"))).toContain('Unsupported("vector(3072)")');
  });
});

describe("no active code path writes to the historical 3072 table", () => {
  it("no tracked server, script or package file inserts into the historical table", () => {
    const files = [...git(["ls-files", "--", "server", "scripts", "packages"])].filter((f) => /\.(ts|tsx|mjs|js|sql)$/.test(f));
    const writers = files.filter((f) => {
      const text = fs.readFileSync(path.join(ROOT, f), "utf8");
      return /INSERT\s+INTO\s+"?legal_corpus_chunk_embeddings"?(?!_local)/i.test(text);
    });
    expect(writers).toEqual([]);
  });
});
