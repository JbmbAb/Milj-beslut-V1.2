/**
 * W-NO-GOOGLE-02A -- the closed registry of LOCAL embedding pipelines, and the explicit
 * 3072 -> 1024 identity boundary.
 *
 * embed-identity-1 (EmbeddingIdentity.ts) is unchanged: it binds six fields and says nothing about
 * dimension. This module adds what it deliberately does not have: the only two admitted local
 * pipelines, frozen, each pinned to an exact Hugging Face revision and a fixed input convention
 * (the frozen A7 candidates, CHUNK-RETRIEVAL-LOCAL-EMBEDDING-DESIGN-01 sections 6-7).
 *
 * An identity is "local" if and only if its (model id, model version, pipeline version) triple is
 * exactly one registered pipeline. Everything else -- in particular every historical identity of
 * the previous 3072-dimensional provider -- is rejected, never reinterpreted, never converted.
 * A revision bump is a new registered pipeline (and a new migration), never an edit in place.
 */

import {
  bindEmbeddingIdentity,
  computeEmbeddingIdentityHash,
  EmbeddingIdentityError,
  type EmbeddingIdentityFields,
} from "./EmbeddingIdentity.js";

/** Dimension of every admitted local pipeline (dense output of both frozen candidates). */
export const LOCAL_EMBEDDING_DIMENSION = 1024 as const;

/**
 * Dimension of the historical, now retired provider. Present only to make the boundary explicit and
 * testable: a vector of this size is never a local embedding and is never padded or truncated into one.
 */
export const LEGACY_GOOGLE_EMBEDDING_DIMENSION = 3072 as const;

export type LocalEmbeddingKey = "bge-m3" | "multilingual-e5-large";

export interface LocalEmbeddingPipelineSpec {
  readonly key: LocalEmbeddingKey;
  /** Becomes embedding_model_id. */
  readonly hf_repo: string;
  /** Becomes embedding_model_version: the full 40-hex Hugging Face commit, never a branch or tag. */
  readonly hf_revision: string;
  /** Becomes embedding_pipeline_version. */
  readonly pipeline_version: string;
  readonly dimension: typeof LOCAL_EMBEDDING_DIMENSION;
  readonly normalization: "l2";
  /** Exact prefix put before every query text (empty = none). Part of the pipeline identity. */
  readonly query_prefix: string;
  /** Exact prefix put before every passage/chunk text (empty = none). Part of the pipeline identity. */
  readonly passage_prefix: string;
  /** Fixed truncation length required by the pipeline, or null = the pinned model's own default. */
  readonly max_seq_length: number | null;
}

const PIPELINES: readonly LocalEmbeddingPipelineSpec[] = Object.freeze([
  Object.freeze({
    key: "bge-m3",
    hf_repo: "BAAI/bge-m3",
    hf_revision: "5617a9f61b028005a4858fdac845db406aefb181",
    pipeline_version: "local-st-bge-m3-dense-v1",
    dimension: LOCAL_EMBEDDING_DIMENSION,
    normalization: "l2",
    query_prefix: "",
    passage_prefix: "",
    max_seq_length: null,
  } as const),
  Object.freeze({
    key: "multilingual-e5-large",
    hf_repo: "intfloat/multilingual-e5-large",
    hf_revision: "3d7cfbdacd47fdda877c5cd8a79fbcc4f2a574f3",
    pipeline_version: "local-st-multilingual-e5-large-v1",
    dimension: LOCAL_EMBEDDING_DIMENSION,
    normalization: "l2",
    query_prefix: "query: ",
    passage_prefix: "passage: ",
    max_seq_length: 512,
  } as const),
]);

export const LOCAL_EMBEDDING_PIPELINES: readonly LocalEmbeddingPipelineSpec[] = PIPELINES;

/** The three fields that, together, say which model and pipeline produced a vector. */
export interface EmbeddingModelTriple {
  readonly embedding_model_id: string;
  readonly embedding_model_version: string;
  readonly embedding_pipeline_version: string;
}

export function getLocalEmbeddingPipelineByKey(key: string): LocalEmbeddingPipelineSpec | undefined {
  return PIPELINES.find((p) => p.key === key);
}

/** Exact-triple lookup: a different revision or pipeline version is NOT the same local pipeline. */
export function findLocalEmbeddingPipeline(triple: EmbeddingModelTriple): LocalEmbeddingPipelineSpec | undefined {
  return PIPELINES.find(
    (p) =>
      p.hf_repo === triple.embedding_model_id &&
      p.hf_revision === triple.embedding_model_version &&
      p.pipeline_version === triple.embedding_pipeline_version,
  );
}

/**
 * Binds a governed chunk to a registered local pipeline. The result is an ordinary embed-identity-1
 * identity; its hash differs from every identity of any other model/revision/pipeline for the same chunk.
 */
export function bindLocalEmbeddingIdentity(
  chunk: { readonly fragment_id: string; readonly materialization_id: string; readonly chunk_content_hash: string },
  key: LocalEmbeddingKey,
): EmbeddingIdentityFields {
  const spec = getLocalEmbeddingPipelineByKey(key);
  if (!spec) {
    throw new EmbeddingIdentityError(
      "EMBEDDING_LOCAL_PIPELINE_UNKNOWN",
      `'${String(key)}' is not a registered local embedding pipeline (admitted: ${PIPELINES.map((p) => p.key).join(", ")})`,
    );
  }
  return bindEmbeddingIdentity({
    fragment_id: chunk.fragment_id,
    materialization_id: chunk.materialization_id,
    chunk_content_hash: chunk.chunk_content_hash,
    embedding_model_id: spec.hf_repo,
    embedding_model_version: spec.hf_revision,
    embedding_pipeline_version: spec.pipeline_version,
  });
}

/**
 * The boundary check. Returns the registered pipeline the identity is bound to, or throws.
 * Also re-derives the identity hash, so a record edited after binding does not pass.
 */
export function assertLocalEmbeddingIdentity(identity: EmbeddingIdentityFields): LocalEmbeddingPipelineSpec {
  const spec = findLocalEmbeddingPipeline(identity);
  if (!spec) {
    throw new EmbeddingIdentityError(
      "EMBEDDING_IDENTITY_NOT_LOCAL",
      `embedding identity (model '${identity.embedding_model_id}', version '${identity.embedding_model_version}', ` +
        `pipeline '${identity.embedding_pipeline_version}') is not a registered local pipeline -- ` +
        "historical or foreign identities are never accepted as local",
    );
  }
  if (computeEmbeddingIdentityHash(identity) !== identity.embedding_identity_hash) {
    throw new EmbeddingIdentityError(
      "EMBEDDING_IDENTITY_HASH_MISMATCH",
      "embedding_identity_hash does not match the identity fields -- the record was altered after binding",
    );
  }
  return spec;
}
