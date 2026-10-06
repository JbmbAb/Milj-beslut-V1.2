/**
 * W-NO-GOOGLE-02A -- the production retrieval composition on the local provider (RED first).
 *
 * Real createLegalRetrievalComposition() with an injected provider and a mocked database client:
 * what is asserted is which table is searched, which identity filters are applied, that a vector
 * of the wrong dimension never reaches the database, and that an unconfigured runtime fails closed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  queryRawUnsafe: vi.fn(async (..._args: unknown[]) => [] as unknown[]),
  findUnique: vi.fn(async (..._args: unknown[]) => null as unknown),
}));

vi.mock("../../server/db/prisma", () => ({
  prisma: {
    $queryRawUnsafe: db.queryRawUnsafe,
    legalCorpusMaterializedChunk: { findUnique: db.findUnique },
  },
}));

import { getLocalEmbeddingPipelineByKey } from "@miljobeslut/mps-embedding-identity";
import { EmbeddingProviderError, type EmbeddingProvider } from "../../server/modules/legal/retrieval/EmbeddingProvider";
import {
  createLegalRetrievalComposition,
  performLegalRetrieval,
  type SearchChunks,
} from "../../server/modules/legal/retrieval/LegalRetrievalComposition";

const BGE = getLocalEmbeddingPipelineByKey("bge-m3")!;

function unit(dim: number): number[] {
  const v = new Array<number>(dim).fill(0);
  v[0] = 1;
  return v;
}

function provider(dim = 1024): EmbeddingProvider & { queryCalls: string[][]; passageCalls: string[][] } {
  const queryCalls: string[][] = [];
  const passageCalls: string[][] = [];
  return {
    model_id: BGE.hf_repo,
    model_version: BGE.hf_revision,
    pipeline_version: BGE.pipeline_version,
    dimension: 1024,
    async embedQueries(texts) {
      queryCalls.push([...texts]);
      return texts.map(() => unit(dim));
    },
    async embedPassages(texts) {
      passageCalls.push([...texts]);
      return texts.map(() => unit(dim));
    },
    queryCalls,
    passageCalls,
  };
}

beforeEach(() => {
  db.queryRawUnsafe.mockClear();
  db.findUnique.mockClear();
});

describe("createLegalRetrievalComposition -- real search path", () => {
  it("searches only the local 1024 table, filtered by the provider's model and pipeline", async () => {
    const deps = createLegalRetrievalComposition({ embeddingProvider: provider() });
    await deps.searchChunks(unit(1024), BGE.hf_repo, BGE.pipeline_version, undefined, null, 5);
    expect(db.queryRawUnsafe).toHaveBeenCalledTimes(1);
    const [sql, ...params] = db.queryRawUnsafe.mock.calls[0]! as [string, ...unknown[]];
    expect(sql).toContain('"legal_corpus_chunk_embeddings_local_v1"');
    expect(sql).not.toMatch(/legal_corpus_chunk_embeddings(?!_local)/);
    expect(sql).toMatch(/\$1::vector\(1024\)/);
    expect(params).toContain(BGE.hf_repo);
    expect(params).toContain(BGE.pipeline_version);
  });

  it("refuses a 3072-dimensional query vector before any SQL runs (no mixed-dimension comparison)", async () => {
    const deps = createLegalRetrievalComposition({ embeddingProvider: provider() });
    await expect(deps.searchChunks(unit(3072), BGE.hf_repo, BGE.pipeline_version, undefined, null, 5)).rejects.toMatchObject({
      code: "EMBEDDING_DIMENSION_MISMATCH",
    });
    expect(db.queryRawUnsafe).not.toHaveBeenCalled();
  });

  it("refuses a Google pipeline version before any SQL runs (old vectors are not a local identity)", async () => {
    const deps = createLegalRetrievalComposition({ embeddingProvider: provider() });
    await expect(
      deps.searchChunks(unit(1024), "gemini-embedding-001", "embed-pipeline-gemini-v1", undefined, null, 5),
    ).rejects.toThrow();
    expect(db.queryRawUnsafe).not.toHaveBeenCalled();
  });

  it("uses the provider that was injected and exposes it unchanged", () => {
    const p = provider();
    expect(createLegalRetrievalComposition({ embeddingProvider: p }).embeddingProvider).toBe(p);
  });
});

describe("createLegalRetrievalComposition -- fail closed without a configured local runtime", () => {
  const saved = { ...process.env };

  afterEach(() => {
    process.env = { ...saved };
  });

  it("throws EMBEDDING_PROVIDER_NOT_CONFIGURED -- a Google key in the environment does not rescue it", () => {
    delete process.env.MIMER_LOCAL_EMBEDDING_MODEL;
    delete process.env.MIMER_LOCAL_EMBEDDING_PYTHON;
    delete process.env.MIMER_LOCAL_EMBEDDING_HF_HOME;
    process.env.GEMINI_API_KEY = "present-but-must-be-ignored";
    try {
      createLegalRetrievalComposition();
      throw new Error("expected a throw");
    } catch (error) {
      expect(error).toBeInstanceOf(EmbeddingProviderError);
      expect((error as EmbeddingProviderError).code).toBe("EMBEDDING_PROVIDER_NOT_CONFIGURED");
    }
  });
});

describe("performLegalRetrieval -- the query is embedded as a query", () => {
  it("calls embedQueries once with the query and never embedPassages", async () => {
    const p = provider();
    const searchChunks: SearchChunks = vi.fn(async () => []);
    await performLegalRetrieval(
      { query: "vad säger lagen om vattenverksamhet" },
      { embeddingProvider: p, searchChunks, lookupChunkRef: async () => null },
    );
    expect(p.queryCalls).toEqual([["vad säger lagen om vattenverksamhet"]]);
    expect(p.passageCalls).toEqual([]);
    expect(searchChunks).toHaveBeenCalledTimes(1);
    expect((searchChunks as ReturnType<typeof vi.fn>).mock.calls[0]![1]).toBe(BGE.hf_repo);
    expect((searchChunks as ReturnType<typeof vi.fn>).mock.calls[0]![2]).toBe(BGE.pipeline_version);
  });
});
