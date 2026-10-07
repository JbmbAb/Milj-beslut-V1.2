-- W-NO-GOOGLE-02A -- the explicit 3072 -> 1024 boundary, database side, for the ONE production-admitted
-- local embedding pipeline.
--
-- Owner decision 2026-10-07 (frozen W-EMBED-MODEL-SELECTION-04): production admits exactly BAAI/bge-m3 at the
-- exact evaluated Hugging Face revision, pipeline local-st-bge-m3-dense-v1, 1024 dimensions. Changing the
-- admitted model, revision or pipeline needs a new owner decision and a NEW migration; it is never an UPDATE of
-- the constraint by hand.
--
-- The historical legal_corpus_chunk_embeddings table (vector 3072) is NOT altered, NOT read as local, NOT copied
-- and NOT dropped by this migration: its rows are historical input only and are never reinterpreted as local
-- embeddings. No data is moved. There is deliberately no view, trigger or function that joins the two.
--
-- What the database itself enforces:
--   * the vector is vector(1024) and NOT NULL (a 3072-dimensional value cannot be stored);
--   * the dimension is an explicit column and is CHECKed to 1024;
--   * the (model, exact Hugging Face revision, pipeline) triple must be EXACTLY the admitted bge-m3 pipeline --
--     the same values as packages/mps-embedding-identity LocalEmbeddingPipelines.ts and
--     server/modules/legal/retrieval/LocalEmbeddingAdmission.ts (a unit test compares them). Another candidate
--     (for example multilingual-e5-large), another revision, or any historical Google identity cannot be stored;
--   * embedding_identity_hash (embed-identity-1) is unique, so replaying an identity is a no-op;
--   * a vector without a governed chunk cannot be stored (foreign key).

CREATE TABLE "legal_corpus_chunk_embeddings_local_v1" (
    "id" TEXT NOT NULL,
    "fragment_id" TEXT NOT NULL,
    "materialization_id" TEXT NOT NULL,
    "chunk_content_hash" TEXT NOT NULL,
    "embedding_model_id" TEXT NOT NULL,
    "embedding_model_version" TEXT NOT NULL,
    "embedding_pipeline_version" TEXT NOT NULL,
    "embedding_identity_hash" TEXT NOT NULL,
    "embedding_dimension" SMALLINT NOT NULL,
    "embedding_vector" vector(1024) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "legal_corpus_chunk_embeddings_local_v1_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "lcel_v1_dimension_chk" CHECK ("embedding_dimension" = 1024),
    CONSTRAINT "lcel_v1_pipeline_binding_chk" CHECK (
        "embedding_pipeline_version" = 'local-st-bge-m3-dense-v1'
        AND "embedding_model_id" = 'BAAI/bge-m3'
        AND "embedding_model_version" = '5617a9f61b028005a4858fdac845db406aefb181'
    )
);

CREATE UNIQUE INDEX "lcel_v1_identity_hash_key"
    ON "legal_corpus_chunk_embeddings_local_v1"("embedding_identity_hash");

CREATE INDEX "legal_corpus_chunk_embeddings_local_v1_fragment_id_idx"
    ON "legal_corpus_chunk_embeddings_local_v1"("fragment_id");

CREATE INDEX "legal_corpus_chunk_embeddings_local_v1_materialization_id_idx"
    ON "legal_corpus_chunk_embeddings_local_v1"("materialization_id");

ALTER TABLE "legal_corpus_chunk_embeddings_local_v1"
    ADD CONSTRAINT "lcel_v1_chunk_fkey"
    FOREIGN KEY ("materialization_id", "fragment_id")
    REFERENCES "legal_corpus_materialized_chunks"("materialization_id", "fragment_id")
    ON DELETE CASCADE ON UPDATE CASCADE;
