-- GOVERNED-LEGAL-CHUNK-SCHEMA-V1
-- Deliberately a separate table from the legacy "legal_corpus_chunks" (mutation-tolerant,
-- position/version-keyed, destructively rechunked by scripts/db/rechunk-legal-corpus.ts's
-- deleteMany-then-recreate pattern). No legacy table is altered by this migration.
-- Insert-only, immutable (no updated_at), content-addressed via fragment_id, bound to an exact
-- governed materialization.

CREATE TABLE "legal_corpus_materialized_chunks" (
    "id" TEXT NOT NULL,
    "fragment_id" TEXT NOT NULL,
    "materialization_id" TEXT NOT NULL,
    "record_id" TEXT NOT NULL,
    "structure_kind" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "chapter" TEXT,
    "paragraph" TEXT,
    "law_section" TEXT,
    "court_section" TEXT,
    "chunk_text" TEXT NOT NULL,
    "content_hash" TEXT NOT NULL,
    "source_projection_ref" TEXT NOT NULL,
    "chunk_policy_version" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "legal_corpus_materialized_chunks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "legal_corpus_materialized_chunks_materialization_id_fragment_i"
  ON "legal_corpus_materialized_chunks"("materialization_id", "fragment_id");
CREATE INDEX "legal_corpus_materialized_chunks_record_id_idx"
  ON "legal_corpus_materialized_chunks"("record_id");
CREATE INDEX "legal_corpus_materialized_chunks_materialization_id_sequence_i"
  ON "legal_corpus_materialized_chunks"("materialization_id", "sequence");
CREATE INDEX "legal_corpus_materialized_chunks_chapter_paragraph_idx"
  ON "legal_corpus_materialized_chunks"("chapter", "paragraph");

ALTER TABLE "legal_corpus_materialized_chunks"
  ADD CONSTRAINT "legal_corpus_materialized_chunks_record_id_fkey"
  FOREIGN KEY ("record_id") REFERENCES "legal_corpus_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "legal_corpus_materialized_chunks"
  ADD CONSTRAINT "legal_corpus_materialized_chunks_materialization_id_fkey"
  FOREIGN KEY ("materialization_id") REFERENCES "legal_corpus_materializations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
