/**
 * W-NO-GOOGLE-02A -- explicit 3072 -> 1024 persistence boundary.
 *
 * The executable persistence path accepts only an embedding issued by LocalEmbeddingProvider after
 * runtime/snapshot verification. A naked vector plus a claimed model identity is not persistable.
 */
import {
  assertLocalEmbeddingIdentity,
  LOCAL_EMBEDDING_DIMENSION,
  LOCAL_EMBEDDING_PIPELINES,
} from "@miljobeslut/mps-embedding-identity";
import { prisma } from "../../../db/prisma";
import { EmbeddingProviderError } from "./EmbeddingProvider";
import {
  isIssuedLocalEmbedding,
  type IssuedLocalEmbedding,
} from "./LocalEmbeddingProvenance";

export const LOCAL_EMBEDDING_TABLE = "legal_corpus_chunk_embeddings_local_v1" as const;

export interface SqlStatement {
  readonly sql: string;
  readonly params: readonly unknown[];
}

export interface PersistEmbeddingResult {
  readonly inserted: boolean;
  readonly embedding_identity_hash: string;
}

export function toVectorLiteral(vector: readonly number[]): string {
  return `[${vector.join(",")}]`;
}

export function assertLocalVector(vector: readonly number[]): void {
  if (!Array.isArray(vector) || vector.length !== LOCAL_EMBEDDING_DIMENSION) {
    throw new EmbeddingProviderError(
      "EMBEDDING_DIMENSION_MISMATCH",
      `a local embedding has exactly ${LOCAL_EMBEDDING_DIMENSION} dimensions, got ${Array.isArray(vector) ? vector.length : "none"} -- vectors are never padded, truncated or converted between dimensions`,
    );
  }
  for (let i = 0; i < vector.length; i++) {
    if (typeof vector[i] !== "number" || !Number.isFinite(vector[i])) {
      throw new EmbeddingProviderError("EMBEDDING_NOT_FINITE", `vector component ${i} is not a finite number`);
    }
  }
}

export function assertLocalQueryVector(vector: readonly number[], pipelineVersion: string): void {
  if (!LOCAL_EMBEDDING_PIPELINES.some((p) => p.pipeline_version === pipelineVersion)) {
    throw new EmbeddingProviderError(
      "EMBEDDING_PIPELINE_NOT_LOCAL",
      `pipeline '${pipelineVersion}' is not a frozen local embedding pipeline`,
    );
  }
  assertLocalVector(vector);
}

export const LOCAL_EMBEDDING_INSERT_SQL = `INSERT INTO "legal_corpus_chunk_embeddings_local_v1"
  ("id", "fragment_id", "materialization_id", "chunk_content_hash",
   "embedding_model_id", "embedding_model_version", "embedding_pipeline_version",
   "embedding_identity_hash", "embedding_dimension", "embedding_vector")
VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, $8::smallint, $9::vector(1024))
ON CONFLICT ("embedding_identity_hash") DO NOTHING
RETURNING "id"`;

export function buildPersistLocalEmbeddingStatement(issued: IssuedLocalEmbedding): SqlStatement {
  if (!isIssuedLocalEmbedding(issued)) {
    throw new EmbeddingProviderError(
      "EMBEDDING_RUNTIME_IDENTITY_MISMATCH",
      "local embedding persistence requires provider-issued runtime provenance; naked or forged vectors are refused",
    );
  }
  const identity = issued.identity;
  const spec = assertLocalEmbeddingIdentity(identity);
  if (spec.key !== issued.model_key || spec.snapshot_manifest_sha256 !== issued.snapshot_manifest_sha256) {
    throw new EmbeddingProviderError(
      "EMBEDDING_RUNTIME_IDENTITY_MISMATCH",
      "issued embedding provenance does not match the frozen model/snapshot identity",
    );
  }
  assertLocalVector(issued.vector);
  return {
    sql: LOCAL_EMBEDDING_INSERT_SQL,
    params: [
      identity.fragment_id,
      identity.materialization_id,
      identity.chunk_content_hash,
      identity.embedding_model_id,
      identity.embedding_model_version,
      identity.embedding_pipeline_version,
      identity.embedding_identity_hash,
      LOCAL_EMBEDDING_DIMENSION,
      toVectorLiteral(issued.vector),
    ],
  };
}

export async function persistLocalChunkEmbedding(issued: IssuedLocalEmbedding): Promise<PersistEmbeddingResult> {
  const statement = buildPersistLocalEmbeddingStatement(issued);
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(LOCAL_EMBEDDING_INSERT_SQL, ...statement.params);
  return { inserted: rows.length > 0, embedding_identity_hash: issued.identity.embedding_identity_hash };
}
