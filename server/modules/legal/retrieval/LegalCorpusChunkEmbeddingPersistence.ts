/**
 * LEGAL-RETRIEVAL-BOUNDED-PILOT-01.
 *
 * Real DB persistence for embedding rows (legal_corpus_chunk_embeddings), and a real,
 * Prisma-backed GovernedChunkLookupPort for @miljobeslut/mps-legal-retrieval-contract.
 * embedding_vector is Unsupported by the Prisma client (same pattern as every other vector
 * column in this schema), so writes/reads go through raw SQL.
 */

import type { EmbeddingIdentityFields } from "@miljobeslut/mps-embedding-identity";
import type { GovernedChunkRef } from "@miljobeslut/mps-legal-retrieval-contract";
import { prisma } from "../../../db/prisma";

export interface PersistEmbeddingResult {
  readonly inserted: boolean;
  readonly embedding_identity_hash: string;
}

/**
 * Idempotent by construction: embedding_identity_hash is UNIQUE at the DB level.
 * ON CONFLICT DO NOTHING means a replay of the exact same identity is a genuine no-op, never a
 * duplicate row and never a constraint-violation error -- provable directly via the returned row
 * count, not just "it didn't throw."
 */
export async function persistChunkEmbedding(
  identity: EmbeddingIdentityFields,
  vector: readonly number[],
): Promise<PersistEmbeddingResult> {
  const vectorLiteral = `[${vector.join(",")}]`;
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `INSERT INTO "legal_corpus_chunk_embeddings"
       ("id", "fragment_id", "materialization_id", "chunk_content_hash",
        "embedding_model_id", "embedding_model_version", "embedding_pipeline_version",
        "embedding_identity_hash", "embedding_vector")
     VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, $8::vector)
     ON CONFLICT ("embedding_identity_hash") DO NOTHING
     RETURNING "id"`,
    identity.fragment_id,
    identity.materialization_id,
    identity.chunk_content_hash,
    identity.embedding_model_id,
    identity.embedding_model_version,
    identity.embedding_pipeline_version,
    identity.embedding_identity_hash,
    vectorLiteral,
  );
  return { inserted: rows.length > 0, embedding_identity_hash: identity.embedding_identity_hash };
}

export async function countChunkEmbeddings(): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
    `SELECT COUNT(*)::bigint AS count FROM "legal_corpus_chunk_embeddings"`,
  );
  return Number(rows[0]?.count ?? 0);
}

export async function countChunkEmbeddingsByIdentityHash(hash: string): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
    `SELECT COUNT(*)::bigint AS count FROM "legal_corpus_chunk_embeddings" WHERE "embedding_identity_hash" = $1`,
    hash,
  );
  return Number(rows[0]?.count ?? 0);
}

/**
 * Real DB-backed chunk refs, for building a GovernedChunkLookupPort (mps-legal-retrieval-
 * contract). That port's `findByFragmentId` is intentionally sync/storage-agnostic for pure
 * unit tests -- the pilot pre-resolves the bounded chunk set into an in-memory
 * GovernedChunkLookupPort (createInMemoryGovernedChunkLookup) built from these REAL rows,
 * rather than adding an async variant to the shared contract package for this one caller.
 */
export async function fetchGovernedChunkRefs(fragmentIds: readonly string[]): Promise<GovernedChunkRef[]> {
  if (fragmentIds.length === 0) return [];
  const rows = await prisma.legalCorpusMaterializedChunk.findMany({
    where: { fragmentId: { in: [...fragmentIds] } },
    select: { fragmentId: true, materializationId: true, contentHash: true, structureKind: true },
  });
  return rows.map((r) => ({
    fragment_id: r.fragmentId,
    materialization_id: r.materializationId,
    content_hash: r.contentHash,
    structure_kind: r.structureKind as "law" | "court" | "standard",
  }));
}
