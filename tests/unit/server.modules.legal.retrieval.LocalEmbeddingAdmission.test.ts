/**
 * W-NO-GOOGLE-02A -- production admission of the local embedding model (RED first).
 *
 * Owner decision 2026-10-07 (W-EMBED-MODEL-SELECTION-04, decision MULTIPLE_DENSE_MODELS_VIABLE_NO_CLEAR_WINNER,
 * operational tie-break): production admits EXACTLY ONE pipeline, BAAI/bge-m3 at the exact evaluated
 * Hugging Face revision, 1024 dimensions. The other frozen candidates stay evaluation candidates and are
 * not production-admitted. This test exercises the REAL admission module (the provider tests mock it).
 */
import { describe, expect, it } from "vitest";
import {
  LOCAL_EMBEDDING_PIPELINES,
  getLocalEmbeddingPipelineByKey,
} from "@miljobeslut/mps-embedding-identity";
import {
  getProductionAdmittedLocalEmbeddingPipeline,
  isProductionAdmittedLocalEmbeddingKey,
  isProductionAdmittedLocalEmbeddingPipelineVersion,
  productionAdmittedLocalEmbeddingKeys,
} from "../../server/modules/legal/retrieval/LocalEmbeddingAdmission";

describe("production admission -- exactly one local pipeline: bge-m3", () => {
  it("admits exactly the key bge-m3 and nothing else", () => {
    expect([...productionAdmittedLocalEmbeddingKeys()]).toEqual(["bge-m3"]);
    expect(isProductionAdmittedLocalEmbeddingKey("bge-m3")).toBe(true);
    expect(isProductionAdmittedLocalEmbeddingKey("multilingual-e5-large")).toBe(false);
    expect(isProductionAdmittedLocalEmbeddingKey("jina-embeddings-v3")).toBe(false);
    expect(isProductionAdmittedLocalEmbeddingKey("Qwen3-Embedding-0.6B")).toBe(false);
    expect(isProductionAdmittedLocalEmbeddingKey("gemini-embedding-001")).toBe(false);
    expect(isProductionAdmittedLocalEmbeddingKey("")).toBe(false);
  });

  it("the admitted pipeline is the exact evaluated bge-m3 revision, 1024 dimensions, L2, no prefixes", () => {
    const spec = getProductionAdmittedLocalEmbeddingPipeline();
    expect(spec.key).toBe("bge-m3");
    expect(spec.hf_repo).toBe("BAAI/bge-m3");
    expect(spec.hf_revision).toBe("5617a9f61b028005a4858fdac845db406aefb181");
    expect(spec.pipeline_version).toBe("local-st-bge-m3-dense-v1");
    expect(spec.dimension).toBe(1024);
    expect(spec.normalization).toBe("l2");
    expect(spec.query_prefix).toBe("");
    expect(spec.passage_prefix).toBe("");
    expect(spec).toBe(getLocalEmbeddingPipelineByKey("bge-m3"));
  });

  it("the pipeline is identified by its version string for read/write guards, and only bge-m3's version qualifies", () => {
    expect(isProductionAdmittedLocalEmbeddingPipelineVersion("local-st-bge-m3-dense-v1")).toBe(true);
    expect(isProductionAdmittedLocalEmbeddingPipelineVersion("local-st-multilingual-e5-large-v1")).toBe(false);
    expect(isProductionAdmittedLocalEmbeddingPipelineVersion("embed-pipeline-gemini-v1")).toBe(false);
  });

  it("the admission list is frozen and every admitted key is a registered frozen pipeline", () => {
    const keys = productionAdmittedLocalEmbeddingKeys();
    expect(Object.isFrozen(keys)).toBe(true);
    expect(() => (keys as string[]).push("multilingual-e5-large")).toThrow();
    for (const key of keys) expect(LOCAL_EMBEDDING_PIPELINES.some((p) => p.key === key)).toBe(true);
    expect(productionAdmittedLocalEmbeddingKeys()).toHaveLength(1);
  });
});

describe("the evaluation candidates that were not selected stay candidates", () => {
  it("multilingual-e5-large remains a registered evaluation candidate but is not production-admitted", () => {
    expect(getLocalEmbeddingPipelineByKey("multilingual-e5-large")).toBeDefined();
    expect(isProductionAdmittedLocalEmbeddingKey("multilingual-e5-large")).toBe(false);
  });
});
