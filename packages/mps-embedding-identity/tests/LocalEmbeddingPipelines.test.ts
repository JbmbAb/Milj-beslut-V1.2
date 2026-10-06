/**
 * W-NO-GOOGLE-02A -- local embedding pipeline identity (RED first).
 *
 * The identity contract embed-identity-1 binds six fields and is NOT changed here. What is added
 * is the closed, frozen registry of the only two admitted LOCAL pipelines (the frozen A7
 * candidates BAAI/bge-m3 and intfloat/multilingual-e5-large) and the explicit 3072 -> 1024 identity
 * boundary: an identity is "local" only if its (model id, exact HF revision, pipeline version)
 * triple is exactly one registered pipeline. Anything else -- in particular every historical Google
 * identity -- is rejected, never reinterpreted.
 */
import { describe, expect, it } from "vitest";
import {
  bindEmbeddingIdentity,
  EmbeddingIdentityError,
} from "../src/index";
import {
  LEGACY_GOOGLE_EMBEDDING_DIMENSION,
  LOCAL_EMBEDDING_DIMENSION,
  LOCAL_EMBEDDING_PIPELINES,
  assertLocalEmbeddingIdentity,
  bindLocalEmbeddingIdentity,
  findLocalEmbeddingPipeline,
  getLocalEmbeddingPipelineByKey,
} from "../src/LocalEmbeddingPipelines";

const CHUNK = {
  fragment_id: "frag:abc",
  materialization_id: "mat:1",
  chunk_content_hash: "hash:abc",
} as const;

const GOOGLE_IDENTITY = bindEmbeddingIdentity({
  ...CHUNK,
  embedding_model_id: "gemini-embedding-001",
  embedding_model_version: "001",
  embedding_pipeline_version: "embed-pipeline-gemini-v1",
});

describe("local embedding pipeline registry", () => {
  it("admits exactly the two frozen A7 candidates and nothing else", () => {
    expect(LOCAL_EMBEDDING_PIPELINES.map((p) => p.key)).toEqual(["bge-m3", "multilingual-e5-large"]);
    expect(LOCAL_EMBEDDING_PIPELINES.map((p) => p.hf_repo)).toEqual([
      "BAAI/bge-m3",
      "intfloat/multilingual-e5-large",
    ]);
    expect(LOCAL_EMBEDDING_PIPELINES.map((p) => p.pipeline_version)).toEqual([
      "local-st-bge-m3-dense-v1",
      "local-st-multilingual-e5-large-v1",
    ]);
  });

  it("pins the exact Hugging Face revision of each candidate (full 40-hex commit)", () => {
    expect(getLocalEmbeddingPipelineByKey("bge-m3")?.hf_revision).toBe("5617a9f61b028005a4858fdac845db406aefb181");
    expect(getLocalEmbeddingPipelineByKey("multilingual-e5-large")?.hf_revision).toBe(
      "3d7cfbdacd47fdda877c5cd8a79fbcc4f2a574f3",
    );
    for (const p of LOCAL_EMBEDDING_PIPELINES) expect(p.hf_revision).toMatch(/^[0-9a-f]{40}$/);
  });

  it("is frozen: no entry can be added, replaced or edited at runtime", () => {
    expect(Object.isFrozen(LOCAL_EMBEDDING_PIPELINES)).toBe(true);
    for (const p of LOCAL_EMBEDDING_PIPELINES) expect(Object.isFrozen(p)).toBe(true);
  });

  it("makes the dimension boundary explicit: local is 1024, the Google history is 3072, they differ", () => {
    expect(LOCAL_EMBEDDING_DIMENSION).toBe(1024);
    expect(LEGACY_GOOGLE_EMBEDDING_DIMENSION).toBe(3072);
    expect(LOCAL_EMBEDDING_DIMENSION).not.toBe(LEGACY_GOOGLE_EMBEDDING_DIMENSION);
    for (const p of LOCAL_EMBEDDING_PIPELINES) {
      expect(p.dimension).toBe(1024);
      expect(p.normalization).toBe("l2");
    }
  });

  it("records the model-specific input convention as part of the fixed pipeline", () => {
    const bge = getLocalEmbeddingPipelineByKey("bge-m3")!;
    const e5 = getLocalEmbeddingPipelineByKey("multilingual-e5-large")!;
    expect([bge.query_prefix, bge.passage_prefix]).toEqual(["", ""]);
    expect([e5.query_prefix, e5.passage_prefix]).toEqual(["query: ", "passage: "]);
    expect(e5.max_seq_length).toBe(512);
  });

  it("offers no third candidate and no Google entry by key", () => {
    for (const key of ["gemini-embedding-001", "gemini-embedding-2", "text-embedding-004", "bge-large", "", "BGE-M3"]) {
      expect(getLocalEmbeddingPipelineByKey(key)).toBeUndefined();
    }
  });
});

describe("bindLocalEmbeddingIdentity", () => {
  it("binds the registered model, exact revision and pipeline into embed-identity-1", () => {
    const id = bindLocalEmbeddingIdentity(CHUNK, "bge-m3");
    expect(id.embedding_model_id).toBe("BAAI/bge-m3");
    expect(id.embedding_model_version).toBe("5617a9f61b028005a4858fdac845db406aefb181");
    expect(id.embedding_pipeline_version).toBe("local-st-bge-m3-dense-v1");
    expect(id.contract_version).toBe("embed-identity-1");
    expect(id.embedding_identity_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic and differs per local pipeline for the same chunk", () => {
    const a1 = bindLocalEmbeddingIdentity(CHUNK, "bge-m3");
    const a2 = bindLocalEmbeddingIdentity(CHUNK, "bge-m3");
    const b = bindLocalEmbeddingIdentity(CHUNK, "multilingual-e5-large");
    expect(a1.embedding_identity_hash).toBe(a2.embedding_identity_hash);
    expect(a1.embedding_identity_hash).not.toBe(b.embedding_identity_hash);
  });

  it("never collides with the historical Google identity of the same chunk", () => {
    for (const key of ["bge-m3", "multilingual-e5-large"] as const) {
      expect(bindLocalEmbeddingIdentity(CHUNK, key).embedding_identity_hash).not.toBe(
        GOOGLE_IDENTITY.embedding_identity_hash,
      );
    }
  });

  it("refuses a key that is not a registered local pipeline", () => {
    expect(() => bindLocalEmbeddingIdentity(CHUNK, "gemini-embedding-001" as never)).toThrow(EmbeddingIdentityError);
  });
});

describe("assertLocalEmbeddingIdentity -- historical Google values are never accepted as local", () => {
  it("accepts exactly the identities that bindLocalEmbeddingIdentity produces", () => {
    for (const key of ["bge-m3", "multilingual-e5-large"] as const) {
      const spec = assertLocalEmbeddingIdentity(bindLocalEmbeddingIdentity(CHUNK, key));
      expect(spec.key).toBe(key);
    }
  });

  it("rejects the historical Google identity (gemini-embedding-001 / 001 / embed-pipeline-gemini-v1)", () => {
    try {
      assertLocalEmbeddingIdentity(GOOGLE_IDENTITY);
      throw new Error("expected a throw");
    } catch (error) {
      expect(error).toBeInstanceOf(EmbeddingIdentityError);
      expect((error as EmbeddingIdentityError).code).toBe("EMBEDDING_IDENTITY_NOT_LOCAL");
    }
  });

  it("rejects the second historical Google model (gemini-embedding-2)", () => {
    const g2 = bindEmbeddingIdentity({
      ...CHUNK,
      embedding_model_id: "gemini-embedding-2",
      embedding_model_version: "001",
      embedding_pipeline_version: "embed-pipeline-gemini-v1",
    });
    expect(() => assertLocalEmbeddingIdentity(g2)).toThrow(EmbeddingIdentityError);
  });

  it("rejects a local model id under a different revision (a revision bump is a new, explicit pipeline)", () => {
    const moved = bindEmbeddingIdentity({
      ...CHUNK,
      embedding_model_id: "BAAI/bge-m3",
      embedding_model_version: "0".repeat(40),
      embedding_pipeline_version: "local-st-bge-m3-dense-v1",
    });
    expect(() => assertLocalEmbeddingIdentity(moved)).toThrow(EmbeddingIdentityError);
  });

  it("rejects a mixed triple (bge-m3 model under the e5 pipeline, and the reverse)", () => {
    const bge = getLocalEmbeddingPipelineByKey("bge-m3")!;
    const e5 = getLocalEmbeddingPipelineByKey("multilingual-e5-large")!;
    const mixed = bindEmbeddingIdentity({
      ...CHUNK,
      embedding_model_id: bge.hf_repo,
      embedding_model_version: bge.hf_revision,
      embedding_pipeline_version: e5.pipeline_version,
    });
    const mixed2 = bindEmbeddingIdentity({
      ...CHUNK,
      embedding_model_id: e5.hf_repo,
      embedding_model_version: e5.hf_revision,
      embedding_pipeline_version: bge.pipeline_version,
    });
    expect(() => assertLocalEmbeddingIdentity(mixed)).toThrow(EmbeddingIdentityError);
    expect(() => assertLocalEmbeddingIdentity(mixed2)).toThrow(EmbeddingIdentityError);
  });

  it("finds a pipeline only by the exact triple", () => {
    const bge = getLocalEmbeddingPipelineByKey("bge-m3")!;
    expect(
      findLocalEmbeddingPipeline({
        embedding_model_id: bge.hf_repo,
        embedding_model_version: bge.hf_revision,
        embedding_pipeline_version: bge.pipeline_version,
      })?.key,
    ).toBe("bge-m3");
    expect(
      findLocalEmbeddingPipeline({
        embedding_model_id: bge.hf_repo,
        embedding_model_version: bge.hf_revision,
        embedding_pipeline_version: "embed-pipeline-gemini-v1",
      }),
    ).toBeUndefined();
  });
});
