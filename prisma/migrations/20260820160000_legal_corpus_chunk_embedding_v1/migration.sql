-- LEGAL-RETRIEVAL-BOUNDED-PILOT-01
-- Separate, append-only embedding table for LegalCorpusMaterializedChunk. Deliberately not a
-- column on the governed chunk table: an embedding is a versioned derivative under a specific
-- model/pipeline, and the same chunk legitimately gets multiple embedding rows over time as
-- models change. embedding_identity_hash is the real identity (fragment_id + materialization_id
-- + chunk_content_hash + embedding_model_id + embedding_model_version + embedding_pipeline_version,
-- see @miljobeslut/mps-embedding-identity) and is UNIQUE, so persisting the same inputs twice is
-- a DB-level no-op via ON CONFLICT DO NOTHING, never a duplicate row.

CREATE TABLE "legal_corpus_chunk_embeddings" (
    "id" TEXT NOT NULL,
    "fragment_id" TEXT NOT NULL,
    "materialization_id" TEXT NOT NULL,
    "chunk_content_hash" TEXT NOT NULL,
    "embedding_model_id" TEXT NOT NULL,
    "embedding_model_version" TEXT NOT NULL,
    "embedding_pipeline_version" TEXT NOT NULL,
    "embedding_identity_hash" TEXT NOT NULL,
    "embedding_vector" vector(3072),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "legal_corpus_chunk_embeddings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "legal_corpus_chunk_embeddings_embedding_identity_hash_key"
    ON "legal_corpus_chunk_embeddings"("embedding_identity_hash");

CREATE INDEX "legal_corpus_chunk_embeddings_fragment_id_idx"
    ON "legal_corpus_chunk_embeddings"("fragment_id");

CREATE INDEX "legal_corpus_chunk_embeddings_materialization_id_idx"
    ON "legal_corpus_chunk_embeddings"("materialization_id");

ALTER TABLE "legal_corpus_chunk_embeddings"
    ADD CONSTRAINT "legal_corpus_chunk_embeddings_materialization_id_fragment_id_fkey"
    FOREIGN KEY ("materialization_id", "fragment_id")
    REFERENCES "legal_corpus_materialized_chunks"("materialization_id", "fragment_id")
    ON DELETE CASCADE ON UPDATE CASCADE;
