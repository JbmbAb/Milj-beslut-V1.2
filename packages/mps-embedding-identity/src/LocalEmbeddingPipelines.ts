/**
 * W-NO-GOOGLE-02A -- the closed registry of LOCAL embedding pipelines, and the explicit
 * 3072 -> 1024 identity boundary.
 *
 * embed-identity-1 (EmbeddingIdentity.ts) is unchanged: it binds six fields and says nothing about
 * dimension. This module adds what it deliberately does not have: the two frozen A7 candidates,
 * each pinned to an exact Hugging Face revision, input convention and runtime-essential snapshot
 * manifest. Production admission is a separate concern and is currently empty.
 */
import { createHash } from "node:crypto";
import {
  bindEmbeddingIdentity,
  computeEmbeddingIdentityHash,
  EmbeddingIdentityError,
  type EmbeddingIdentityFields,
} from "./EmbeddingIdentity.js";

/** Dimension of every frozen local candidate. */
export const LOCAL_EMBEDDING_DIMENSION = 1024 as const;

/** Historical Google vectors remain a separate, retired identity/persistence space. */
export const LEGACY_GOOGLE_EMBEDDING_DIMENSION = 3072 as const;

export type LocalEmbeddingKey = "bge-m3" | "multilingual-e5-large";

export interface SnapshotManifestFile {
  readonly path: string;
  readonly algo: "sha256" | "git-blob-sha1";
  readonly digest: string;
  readonly size: number;
}

/**
 * Canonical identity of the runtime-essential file manifest.
 * File order is not authority: sort by path, then bind path/algo/digest/size with NUL separators.
 */
export function computeSnapshotManifestSha256(files: readonly SnapshotManifestFile[]): string {
  const sorted = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const hash = createHash("sha256");
  for (const file of sorted) {
    hash.update(file.path, "utf8");
    hash.update("\0");
    hash.update(file.algo, "utf8");
    hash.update("\0");
    hash.update(file.digest, "ascii");
    hash.update("\0");
    hash.update(String(file.size), "ascii");
    hash.update("\n");
  }
  return hash.digest("hex");
}

export interface LocalEmbeddingPipelineSpec {
  readonly key: LocalEmbeddingKey;
  /** Becomes embedding_model_id. */
  readonly hf_repo: string;
  /** Becomes embedding_model_version: full 40-hex Hugging Face commit. */
  readonly hf_revision: string;
  /** Becomes embedding_pipeline_version. */
  readonly pipeline_version: string;
  readonly dimension: typeof LOCAL_EMBEDDING_DIMENSION;
  readonly normalization: "l2";
  /** SHA-256 of the runtime-essential file manifest verified by the Python worker before model load. */
  readonly snapshot_manifest_sha256: string;
  readonly query_prefix: string;
  readonly passage_prefix: string;
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
    snapshot_manifest_sha256: "ad53098aac8c75a64934f63661527777481de725b45c8daa0d2bd44468372a66",
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
    snapshot_manifest_sha256: "184a4cbfce0022ad5454ef20a4f484b5811f6d85bc1010a1bde6136fcc8e3c19",
    query_prefix: "query: ",
    passage_prefix: "passage: ",
    max_seq_length: 512,
  } as const),
]);

export const LOCAL_EMBEDDING_PIPELINES: readonly LocalEmbeddingPipelineSpec[] = PIPELINES;

export interface EmbeddingModelTriple {
  readonly embedding_model_id: string;
  readonly embedding_model_version: string;
  readonly embedding_pipeline_version: string;
}

export function getLocalEmbeddingPipelineByKey(key: string): LocalEmbeddingPipelineSpec | undefined {
  return PIPELINES.find((p) => p.key === key);
}

export function findLocalEmbeddingPipeline(triple: EmbeddingModelTriple): LocalEmbeddingPipelineSpec | undefined {
  return PIPELINES.find(
    (p) =>
      p.hf_repo === triple.embedding_model_id &&
      p.hf_revision === triple.embedding_model_version &&
      p.pipeline_version === triple.embedding_pipeline_version,
  );
}

export function bindLocalEmbeddingIdentity(
  chunk: { readonly fragment_id: string; readonly materialization_id: string; readonly chunk_content_hash: string },
  key: LocalEmbeddingKey,
): EmbeddingIdentityFields {
  const spec = getLocalEmbeddingPipelineByKey(key);
  if (!spec) {
    throw new EmbeddingIdentityError(
      "EMBEDDING_LOCAL_PIPELINE_UNKNOWN",
      `'${String(key)}' is not a registered local embedding pipeline (frozen candidates: ${PIPELINES.map((p) => p.key).join(", ")})`,
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

export function assertLocalEmbeddingIdentity(identity: EmbeddingIdentityFields): LocalEmbeddingPipelineSpec {
  const spec = findLocalEmbeddingPipeline(identity);
  if (!spec) {
    throw new EmbeddingIdentityError(
      "EMBEDDING_IDENTITY_NOT_LOCAL",
      `embedding identity (model '${identity.embedding_model_id}', version '${identity.embedding_model_version}', pipeline '${identity.embedding_pipeline_version}') is not a frozen local pipeline -- historical or foreign identities are never accepted as local`,
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
