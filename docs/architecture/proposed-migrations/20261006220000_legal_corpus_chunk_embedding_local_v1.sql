-- W-NO-GOOGLE-02A -- PROPOSAL. NOT APPLIED. Do not run `prisma migrate deploy` with this file without
-- the dedicated Prisma-migration Dev-Gov unit and Jimmy's explicit approval
-- (CHUNK-RETRIEVAL-LOCAL-EMBEDDING-DESIGN-01 section 8).
--
-- The explicit 3072 -> 1024 boundary, database side.
--
-- Local embeddings (the two frozen A7 candidates, both 1024-dimensional) get their OWN versioned
-- table. The historical legal_corpus_chunk_embeddings table (vector 3072) is NOT altered, NOT read,
-- NOT copied and NOT dropped by this migration: its rows are historical input only and are never
-- reinterpreted as local embeddings. No data is moved. There is deliberately no view, trigger or
-- function that joins the two.
--
-- What the database itself enforces:
--   * the vector is vector(1024) and NOT NULL (a 3072-dimensional value cannot be stored);
--   * the dimension is an explicit column and is CHECKed to 1024;
--   * the (model, exact Hugging Face revision, pipeline) triple must be one of the two admitted
--     local pipelines -- the same values as packages/mps-embedding-identity LocalEmbeddingPipelines.ts
--     (a unit test compares the two). A third candidate, or a new revision of a candidate, needs a new
--     migration; it is never an UPDATE of a constraint by hand;
--   * embedding_identity_hash (embed-identity-1) is unique, so replaying an identity is a no-op.

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
        (
            "embedding_pipeline_version" = 'local-st-bge-m3-dense-v1'
            AND "embedding_model_id" = 'BAAI/bge-m3'
            AND "embedding_model_version" = '5617a9f61b028005a4858fdac845db406aefb181'
        )
        OR
        (
            "embedding_pipeline_version" = 'local-st-multilingual-e5-large-v1'
            AND "embedding_model_id" = 'intfloat/multilingual-e5-large'
            AND "embedding_model_version" = '3d7cfbdacd47fdda877c5cd8a79fbcc4f2a574f3'
        )
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
