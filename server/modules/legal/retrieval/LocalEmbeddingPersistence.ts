/**
 * W-NO-GOOGLE-02A -- the explicit 3072 -> 1024 persistence boundary.
 *
 * Local embeddings (1024 dimensions, one of the two registered pipelines) live in their own
 * versioned table. They never touch the historical 3072-dimensional table: that table is
 * historical input only, is never written again, never read as local, and is never converted.
 *
 * The boundary is enforced three times, so no single layer is trusted alone:
 *   1. here, before any SQL exists: the identity must be exactly a registered local pipeline and the
 *      vector exactly 1024 finite numbers (no padding, no truncation);
 *   2. in the statement: the vector is cast to vector(1024) and the dimension is written explicitly;
 *   3. in the database: vector(1024) NOT NULL, CHECK on the dimension, and CHECK pinning the only two
 *      admitted (model, revision, pipeline) triples (see the migration proposal).
 *
 * Read side: assertLocalQueryVector gives the search the same guarantee, so a query vector of
 * another dimension never reaches the database to be compared against stored vectors.
 */

import {
  assertLocalEmbeddingIdentity,
  LOCAL_EMBEDDING_DIMENSION,
  LOCAL_EMBEDDING_PIPELINES,
  type EmbeddingIdentityFields,
} from "@miljobeslut/mps-embedding-identity";
import { prisma } from "../../../db/prisma";
import { EmbeddingProviderError } from "./EmbeddingProvider";

export const LOCAL_EMBEDDING_TABLE = "legal_corpus_chunk_embeddings_local_v1" as const;

export interface SqlStatement {
  readonly sql: string;
  readonly params: readonly unknown[];
}

export interface PersistEmbeddingResult {
  readonly inserted: boolean;
  readonly embedding_identity_hash: string;
}

export interface LocalEmbeddingSqlExecutor {
  /** Runs one statement and returns the rows of its RETURNING clause. */
  queryRawUnsafe(sql: string, ...params: unknown[]): Promise<ReadonlyArray<{ readonly id: string }>>;
}

/** pgvector text form. The caller has already proven the vector finite and 1024-long. */
export function toVectorLiteral(vector: readonly number[]): string {
  return `[${vector.join(",")}]`;
}

/** Exactly LOCAL_EMBEDDING_DIMENSION finite numbers; anything else is an error, never adapted. */
export function assertLocalVector(vector: readonly number[]): void {
  if (!Array.isArray(vector) || vector.length !== LOCAL_EMBEDDING_DIMENSION) {
    throw new EmbeddingProviderError(
      "EMBEDDING_DIMENSION_MISMATCH",
      `a local embedding has exactly ${LOCAL_EMBEDDING_DIMENSION} dimensions, got ${Array.isArray(vector) ? vector.length : "none"} -- ` +
        "vectors are never padded, truncated or converted between dimensions",
    );
  }
  for (let i = 0; i < vector.length; i++) {
    if (typeof vector[i] !== "number" || !Number.isFinite(vector[i])) {
      throw new EmbeddingProviderError("EMBEDDING_NOT_FINITE", `vector component ${i} is not a finite number`);
    }
  }
}

/** Read-side boundary: a query vector for a registered local pipeline, or an error. */
export function assertLocalQueryVector(vector: readonly number[], pipelineVersion: string): void {
  if (!LOCAL_EMBEDDING_PIPELINES.some((p) => p.pipeline_version === pipelineVersion)) {
    throw new EmbeddingProviderError(
      "EMBEDDING_PIPELINE_NOT_LOCAL",
      `pipeline '${pipelineVersion}' is not a registered local embedding pipeline`,
    );
  }
  assertLocalVector(vector);
}

export function buildPersistLocalEmbeddingStatement(
  identity: EmbeddingIdentityFields,
  vector: readonly number[],
): SqlStatement {
  assertLocalEmbeddingIdentity(identity);
  assertLocalVector(vector);
  return {
    sql:
      `INSERT INTO "${LOCAL_EMBEDDING_TABLE}"\n` +
      `  ("id", "fragment_id", "materialization_id", "chunk_content_hash",\n` +
      `   "embedding_model_id", "embedding_model_version", "embedding_pipeline_version",\n` +
      `   "embedding_identity_hash", "embedding_dimension", "embedding_vector")\n` +
      `VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, $8::smallint, $9::vector(${LOCAL_EMBEDDING_DIMENSION}))\n` +
      `ON CONFLICT ("embedding_identity_hash") DO NOTHING\n` +
      `RETURNING "id"`,
    params: [
      identity.fragment_id,
      identity.materialization_id,
      identity.chunk_content_hash,
      identity.embedding_model_id,
      identity.embedding_model_version,
      identity.embedding_pipeline_version,
      identity.embedding_identity_hash,
      LOCAL_EMBEDDING_DIMENSION,
      toVectorLiteral(vector),
    ],
  };
}

const prismaExecutor: LocalEmbeddingSqlExecutor = {
  queryRawUnsafe: (sql, ...params) => prisma.$queryRawUnsafe<Array<{ id: string }>>(sql, ...params),
};

/**
 * Idempotent: the identity hash is UNIQUE, so replaying the exact same identity is a genuine no-op
 * (ON CONFLICT DO NOTHING returns no row), never a duplicate and never a constraint error.
 */
export async function persistLocalChunkEmbedding(
  identity: EmbeddingIdentityFields,
  vector: readonly number[],
  executor: LocalEmbeddingSqlExecutor = prismaExecutor,
): Promise<PersistEmbeddingResult> {
  const statement = buildPersistLocalEmbeddingStatement(identity, vector);
  const rows = await executor.queryRawUnsafe(statement.sql, ...statement.params);
  return { inserted: rows.length > 0, embedding_identity_hash: identity.embedding_identity_hash };
}
