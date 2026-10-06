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

import {
  getLocalEmbeddingPipelineByKey,
  LOCAL_EMBEDDING_PIPELINES,
} from "@miljobeslut/mps-embedding-identity";
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

function vec(dim: number, hot = 0): number[] {
  const v = new Array<number>(dim).fill(0);
  v[hot % dim] = 1;
  return v;
}

function runtime(): LocalEmbeddingRuntimeReport {
  return {
    model_key: BGE.key,
    hf_repo: BGE.hf_repo,
    hf_revision: BGE.hf_revision,
    pipeline_version: BGE.pipeline_version,
    dimension: 1024,
    normalization: "l2",
    device: "cuda:0",
    dtype: "float16",
    max_seq_length: 8192,
    truncated_count: 0,
    snapshot_revision: BGE.hf_revision,
    snapshot_manifest_sha256: BGE.snapshot_manifest_sha256,
    interpreter_realpath: "D:/runtime/python.exe",
    library_versions: { torch: "test" },
  };
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
});

describe("local 1024 persistence proposal is frozen but non-executable", () => {
  const proposalDir = path.join(ROOT, "docs/architecture/proposed-migrations");
  const proposalSql = path.join(proposalDir, "20261006220000_legal_corpus_chunk_embedding_local_v1.sql");
  const proposalPrisma = path.join(proposalDir, "20261006220000_legal_corpus_chunk_embedding_local_v1.prisma.proposal.md");

  it("exists only outside Prisma migration discovery", () => {
    expect(fs.existsSync(proposalSql)).toBe(true);
    expect(fs.existsSync(proposalPrisma)).toBe(true);
    const liveDirs = fs.readdirSync(path.join(ROOT, "prisma/migrations")).filter(
      (d) => d.endsWith("_legal_corpus_chunk_embedding_local_v1"),
    );
    expect(liveDirs).toEqual([]);
  });

  const sql = fs.existsSync(proposalSql) ? fs.readFileSync(proposalSql, "utf8") : "";
  const code = sql
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

  it("proposes a separate vector(1024) table and explicit dimension check", () => {
    expect(code).toContain(`CREATE TABLE "${LOCAL_EMBEDDING_TABLE}"`);
    expect(code).toMatch(/"embedding_vector"\s+vector\(1024\)\s+NOT NULL/);
    expect(code).toMatch(/CHECK\s*\(\s*"embedding_dimension"\s*=\s*1024\s*\)/);
    expect(code).not.toContain("3072");
  });

  it("pins only the two frozen evaluation candidates in the current proposal; no Google triple", () => {
    for (const pipeline of LOCAL_EMBEDDING_PIPELINES) {
      expect(code).toContain(`'${pipeline.hf_repo}'`);
      expect(code).toContain(`'${pipeline.hf_revision}'`);
      expect(code).toContain(`'${pipeline.pipeline_version}'`);
    }
    expect(code).not.toMatch(/gemini|google|embed-pipeline-gemini/i);
  });

  it("contains no data copy/destructive DML; ON UPDATE CASCADE is not mistaken for UPDATE DML", () => {
    const withoutFkClause = code.replace(/ON\s+UPDATE\s+CASCADE/gi, "");
    expect(withoutFkClause).not.toMatch(
      /\b(INSERT\s+INTO|UPDATE\s+["A-Za-z]|DELETE\s+FROM|TRUNCATE|DROP\s+(TABLE|COLUMN|INDEX|CONSTRAINT))/i,
    );
    expect(code).not.toMatch(/ALTER\s+TABLE\s+"legal_corpus_chunk_embeddings"/);
  });

  it("keeps the proposed Prisma model out of live schema so db push cannot create it", () => {
    const schema = fs.readFileSync(path.join(ROOT, "prisma/schema.prisma"), "utf8");
    expect(schema).not.toMatch(/model LegalCorpusChunkEmbeddingLocalV1\s*\{/);
    expect(schema).not.toContain("localEmbeddings LegalCorpusChunkEmbeddingLocalV1[]");
    expect(schema).not.toContain('@@map("legal_corpus_chunk_embeddings_local_v1")');
    const proposal = fs.readFileSync(proposalPrisma, "utf8");
    expect(proposal).toMatch(/model LegalCorpusChunkEmbeddingLocalV1\s*\{/);
    expect(proposal).toContain('Unsupported("vector(1024)")');
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
