/**
 * W-NO-GOOGLE-02A -- explicit 3072 -> 1024 persistence/provenance boundary.
 *
 * Production persistence accepts only an object issued by the verified local provider. The 1024
 * table remains a non-executable proposal until the governed evaluation selects one model.
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

import { getLocalEmbeddingPipelineByKey } from "@miljobeslut/mps-embedding-identity";
import { getProductionAdmittedLocalEmbeddingPipeline } from "../../server/modules/legal/retrieval/LocalEmbeddingAdmission";
import { EmbeddingProviderError } from "../../server/modules/legal/retrieval/EmbeddingProvider";
import {
  createLocalEmbeddingProvider,
  type LocalEmbeddingRuntimeReport,
} from "../../server/modules/legal/retrieval/LocalEmbeddingProvider";
import {
  LOCAL_EMBEDDING_INSERT_SQL,
  LOCAL_EMBEDDING_TABLE,
  assertLocalQueryVector,
  assertLocalVector,
  buildPersistLocalEmbeddingStatement,
  persistLocalChunkEmbedding,
  toVectorLiteral,
} from "../../server/modules/legal/retrieval/LocalEmbeddingPersistence";
import { isIssuedLocalEmbedding } from "../../server/modules/legal/retrieval/LocalEmbeddingProvenance";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const BGE = getLocalEmbeddingPipelineByKey("bge-m3")!;
const E5 = getLocalEmbeddingPipelineByKey("multilingual-e5-large")!;

function vec(dim: number, hot = 0): number[] {
  const v = new Array<number>(dim).fill(0);
  v[hot % dim] = 1;
  return v;
}

function runtimeFor(spec: typeof BGE): LocalEmbeddingRuntimeReport {
  return {
    model_key: spec.key,
    hf_repo: spec.hf_repo,
    hf_revision: spec.hf_revision,
    pipeline_version: spec.pipeline_version,
    dimension: 1024,
    normalization: "l2",
    device: "cuda:0",
    dtype: "float32",
    max_seq_length: spec.max_seq_length ?? 8192,
    truncated_count: 0,
    snapshot_revision: spec.hf_revision,
    snapshot_manifest_sha256: spec.snapshot_manifest_sha256,
    interpreter_realpath: "D:/runtime/python.exe",
    library_versions: { torch: "test" },
  };
}

function runtime(): LocalEmbeddingRuntimeReport {
  return runtimeFor(BGE);
}

async function issued() {
  const provider = createLocalEmbeddingProvider({
    key: BGE.key,
    transport: {
      async embed(_spec, request) {
        return { runtime: runtime(), vectors: request.texts.map((_t, i) => vec(1024, i)) };
      },
    },
  });
  const [value] = await provider.embedPassagesIssued([
    { fragment_id: "frag:abc", materialization_id: "mat:1", chunk_content_hash: "hash:abc", text: "body" },
  ]);
  return value!;
}

function git(args: string[]): string[] {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).split(/\r?\n/).filter(Boolean);
}

describe("provider-issued persistence boundary", () => {
  beforeEach(() => db.queryRawUnsafe.mockReset());

  it("builds the one local insert only from provider-issued provenance", async () => {
    const value = await issued();
    expect(isIssuedLocalEmbedding(value)).toBe(true);
    const { sql, params } = buildPersistLocalEmbeddingStatement(value);
    expect(LOCAL_EMBEDDING_TABLE).toBe("legal_corpus_chunk_embeddings_local_v1");
    expect(sql).toContain(`INSERT INTO "${LOCAL_EMBEDDING_TABLE}"`);
    expect(sql).toContain("$9::vector(1024)");
    expect(params).toContain(value.identity.embedding_identity_hash);
    expect(params).toContain(1024);
    expect(params.at(-1)).toBe(toVectorLiteral(value.vector));
  });

  it("rejects a shape-identical forged/copy object before SQL", async () => {
    const value = await issued();
    const forged = { ...value, identity: { ...value.identity }, vector: [...value.vector] };
    expect(isIssuedLocalEmbedding(forged)).toBe(false);
    expect(() => buildPersistLocalEmbeddingStatement(forged as never)).toThrow(EmbeddingProviderError);
    expect(db.queryRawUnsafe).not.toHaveBeenCalled();
  });

  it("provider refuses 3072 before an issued persistence object can exist", async () => {
    const provider = createLocalEmbeddingProvider({
      key: BGE.key,
      transport: {
        async embed() {
          return { runtime: runtime(), vectors: [vec(3072)] };
        },
      },
    });
    await expect(
      provider.embedPassagesIssued([
        { fragment_id: "frag:x", materialization_id: "mat:x", chunk_content_hash: "hash:x", text: "body" },
      ]),
    ).rejects.toMatchObject({ code: "EMBEDDING_DIMENSION_MISMATCH" });
  });

  it("the raw vector guard separately rejects 3072, 768 and non-finite vectors", () => {
    expect(() => assertLocalVector(vec(3072))).toThrow(EmbeddingProviderError);
    expect(() => assertLocalVector(vec(768))).toThrow(EmbeddingProviderError);
    const bad = vec(1024);
    bad[5] = Number.POSITIVE_INFINITY;
    expect(() => assertLocalVector(bad)).toThrow(EmbeddingProviderError);
  });

  it("executes exactly the pinned insert and reports insert/replay", async () => {
    const value = await issued();
    db.queryRawUnsafe.mockResolvedValueOnce([{ id: "row-1" }]);
    await expect(persistLocalChunkEmbedding(value)).resolves.toEqual({
      inserted: true,
      embedding_identity_hash: value.identity.embedding_identity_hash,
    });
    expect(db.queryRawUnsafe).toHaveBeenCalledTimes(1);
    expect(db.queryRawUnsafe.mock.calls[0]![0]).toBe(LOCAL_EMBEDDING_INSERT_SQL);

    db.queryRawUnsafe.mockReset();
    db.queryRawUnsafe.mockResolvedValueOnce([]);
    await expect(persistLocalChunkEmbedding(value)).resolves.toEqual({
      inserted: false,
      embedding_identity_hash: value.identity.embedding_identity_hash,
    });
  });

  it("the provider issuer is not used by another production server module", () => {
    const files = git(["ls-files", "--", "server/modules/legal/retrieval/*.ts"]);
    const users = files.filter((file) => {
      const text = fs.readFileSync(path.join(ROOT, file), "utf8");
      return text.includes("issueLocalEmbeddingForProvider");
    });
    expect(users).toEqual([
      "server/modules/legal/retrieval/LocalEmbeddingProvenance.ts",
      "server/modules/legal/retrieval/LocalEmbeddingProvider.ts",
    ]);
  });
});

describe("assertLocalQueryVector -- read-side dimension and pipeline boundary", () => {
  it("accepts finite 1024 for a frozen local pipeline", () => {
    expect(() => assertLocalQueryVector(vec(1024), BGE.pipeline_version)).not.toThrow();
  });

  it("rejects 3072 and historical Google pipeline identities", () => {
    expect(() => assertLocalQueryVector(vec(3072), BGE.pipeline_version)).toThrow(EmbeddingProviderError);
    expect(() => assertLocalQueryVector(vec(1024), "embed-pipeline-gemini-v1")).toThrow(EmbeddingProviderError);
  });

  // Owner decision 2026-10-07: only the production-admitted pipeline (bge-m3) may be read or written.
  it("rejects the evaluation-only e5 pipeline on the read side even though it is a frozen registry entry", () => {
    expect(() => assertLocalQueryVector(vec(1024), E5.pipeline_version)).toThrow(EmbeddingProviderError);
    try {
      assertLocalQueryVector(vec(1024), E5.pipeline_version);
    } catch (error) {
      expect((error as EmbeddingProviderError).code).toBe("EMBEDDING_MODEL_NOT_ALLOWED");
    }
  });
});

describe("write side admits only the production pipeline (bge-m3)", () => {
  it("builds an insert for a bge-m3 issued embedding", async () => {
    const value = await issued();
    expect(() => buildPersistLocalEmbeddingStatement(value)).not.toThrow();
  });

  it("refuses to persist a provider-issued e5 embedding: evaluation candidates never reach the production table", async () => {
    const provider = createLocalEmbeddingProvider({
      key: E5.key,
      transport: {
        async embed(_spec, request) {
          return { runtime: runtimeFor(E5), vectors: request.texts.map((_t, i) => vec(1024, i)) };
        },
      },
    });
    const [value] = await provider.embedPassagesIssued([
      { fragment_id: "frag:e5", materialization_id: "mat:1", chunk_content_hash: "hash:e5", text: "body" },
    ]);
    expect(isIssuedLocalEmbedding(value)).toBe(true);
    expect(() => buildPersistLocalEmbeddingStatement(value!)).toThrow(EmbeddingProviderError);
    await expect(persistLocalChunkEmbedding(value!)).rejects.toMatchObject({ code: "EMBEDDING_MODEL_NOT_ALLOWED" });
    expect(db.queryRawUnsafe).not.toHaveBeenCalled();
  });
});

// The 1024 table is now part of the real migration history (owner decision 2026-10-07 selected bge-m3). It is
// still NOT applied by this unit to any live or shared database: the migration is committed, unpushed, and
// proven only in a disposable container.
describe("local 1024 persistence migration -- one admitted pipeline", () => {
  const migrationsDir = path.join(ROOT, "prisma/migrations");
  const liveDirs = fs.readdirSync(migrationsDir).filter((d) => d.endsWith("_legal_corpus_chunk_embedding_local_v1"));
  const sqlFile = liveDirs.length === 1 ? path.join(migrationsDir, liveDirs[0]!, "migration.sql") : "";
  const sql = sqlFile && fs.existsSync(sqlFile) ? fs.readFileSync(sqlFile, "utf8") : "";
  const code = sql
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

  it("exists exactly once in the real migration history and sorts after every earlier migration", () => {
    expect(liveDirs).toHaveLength(1);
    expect(sql.length).toBeGreaterThan(0);
    const all = fs.readdirSync(migrationsDir).filter((d) => /^\d{8,14}_/.test(d)).sort();
    expect(all[all.length - 1]).toBe(liveDirs[0]);
  });

  it("the earlier proposal location no longer holds a second, divergent copy", () => {
    const proposalDir = path.join(ROOT, "docs/architecture/proposed-migrations");
    const leftovers = fs.existsSync(proposalDir)
      ? fs.readdirSync(proposalDir).filter((f) => f.includes("legal_corpus_chunk_embedding_local_v1"))
      : [];
    expect(leftovers).toEqual([]);
  });

  it("creates a separate vector(1024) table with an explicit dimension check; no 3072 anywhere", () => {
    expect(code).toContain(`CREATE TABLE "${LOCAL_EMBEDDING_TABLE}"`);
    expect(code).toMatch(/"embedding_vector"\s+vector\(1024\)\s+NOT NULL/);
    expect(code).toMatch(/CHECK\s*\(\s*"embedding_dimension"\s*=\s*1024\s*\)/);
    expect(code).not.toContain("3072");
  });

  it("pins EXACTLY the one admitted pipeline triple (bge-m3); e5 and Google can not be stored", () => {
    const admitted = getProductionAdmittedLocalEmbeddingPipeline();
    expect(code).toContain(`'${admitted.hf_repo}'`);
    expect(code).toContain(`'${admitted.hf_revision}'`);
    expect(code).toContain(`'${admitted.pipeline_version}'`);
    expect(E5.hf_repo).not.toBe(admitted.hf_repo);
    expect(code).not.toContain(`'${E5.hf_repo}'`);
    expect(code).not.toContain(`'${E5.hf_revision}'`);
    expect(code).not.toContain(`'${E5.pipeline_version}'`);
    expect(code).not.toMatch(/gemini|google|embed-pipeline-gemini/i);
    const checks = code.match(/CONSTRAINT\s+"lcel_v1_pipeline_binding_chk"\s+CHECK\s*\(([\s\S]*?)\)\s*\n\s*\)\s*;/);
    expect(checks, "the pipeline binding CHECK must be present").not.toBeNull();
    expect(checks![1]!).not.toMatch(/\bOR\b/i);
  });

  it("contains no data copy/destructive DML; ON UPDATE CASCADE is not mistaken for UPDATE DML", () => {
    const withoutFkClause = code.replace(/ON\s+UPDATE\s+CASCADE/gi, "");
    expect(withoutFkClause).not.toMatch(
      /\b(INSERT\s+INTO|UPDATE\s+["A-Za-z]|DELETE\s+FROM|TRUNCATE|DROP\s+(TABLE|COLUMN|INDEX|CONSTRAINT))/i,
    );
    expect(code).not.toMatch(/ALTER\s+TABLE\s+"legal_corpus_chunk_embeddings"/);
  });

  it("the Prisma schema models the table (so db push / migrate diff see no drift) with the relation and the unsupported 1024 vector", () => {
    const schema = fs.readFileSync(path.join(ROOT, "prisma/schema.prisma"), "utf8");
    expect(schema).toMatch(/model LegalCorpusChunkEmbeddingLocalV1\s*\{/);
    expect(schema).toContain("localEmbeddings LegalCorpusChunkEmbeddingLocalV1[]");
    expect(schema).toContain('@@map("legal_corpus_chunk_embeddings_local_v1")');
    expect(schema).toContain('Unsupported("vector(1024)")');
    // the legacy 3072 model is untouched and separate
    expect(schema).toContain('@@map("legal_corpus_chunk_embeddings")');
    expect(schema).toContain('Unsupported("vector(3072)")');
  });
});

describe("historical vector(3072) table is not an active write target", () => {
  it("no tracked server, script or package file inserts into it", () => {
    const files = [...git(["ls-files", "--", "server", "scripts", "packages"])].filter((f) =>
      /\.(ts|tsx|mjs|js|sql)$/.test(f),
    );
    const writers = files.filter((file) => {
      const text = fs.readFileSync(path.join(ROOT, file), "utf8");
      return /INSERT\s+INTO\s+"?legal_corpus_chunk_embeddings"?(?!_local)/i.test(text);
    });
    expect(writers).toEqual([]);
  });
});
