-- LEGAL_CORPUS_MATERIALIZATION_PERSISTENCE_V1
-- Governed corpus provenance is written only after CorpusImportGate validation passes.

CREATE TABLE "legal_corpus_materializations" (
    "id" TEXT NOT NULL,
    "canonical_record_key" TEXT NOT NULL,
    "logical_source_id" TEXT NOT NULL,
    "registry_artifact_id" TEXT NOT NULL,
    "registry_source_content_hash" TEXT NOT NULL,
    "raw_source_ref" JSONB NOT NULL,
    "raw_source_content_hash" TEXT NOT NULL,
    "text_projection_artifact_id" TEXT NOT NULL,
    "text_projection_hash" TEXT NOT NULL,
    "text_projection_version" TEXT NOT NULL,
    "corpus_materialization_version" TEXT NOT NULL,
    "corpus_record_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "legal_corpus_materializations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "legal_corpus_ingestion_manifest_entries" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "materialization_id" TEXT NOT NULL,
    "ingestion_status" TEXT NOT NULL,
    "admission_outcome" TEXT NOT NULL,
    "source_manifest_ref" JSONB NOT NULL,
    "corpus_import_attestation" JSONB NOT NULL,
    "corpus_import_attestation_ref" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "legal_corpus_ingestion_manifest_entries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "legal_corpus_materializations_canonical_record_key_key"
  ON "legal_corpus_materializations"("canonical_record_key");
CREATE UNIQUE INDEX "legal_corpus_materializations_corpus_record_id_key"
  ON "legal_corpus_materializations"("corpus_record_id");
CREATE UNIQUE INDEX "legal_corpus_materializations_identity_key"
  ON "legal_corpus_materializations"("logical_source_id", "registry_artifact_id", "raw_source_content_hash", "text_projection_hash", "text_projection_version", "corpus_materialization_version");
CREATE INDEX "legal_corpus_materializations_logical_source_id_idx"
  ON "legal_corpus_materializations"("logical_source_id");
CREATE INDEX "legal_corpus_materializations_registry_artifact_id_idx"
  ON "legal_corpus_materializations"("registry_artifact_id");
CREATE UNIQUE INDEX "legal_corpus_ingestion_manifest_entries_run_id_document_id_key"
  ON "legal_corpus_ingestion_manifest_entries"("run_id", "document_id");
CREATE INDEX "legal_corpus_ingestion_manifest_entries_materialization_id_idx"
  ON "legal_corpus_ingestion_manifest_entries"("materialization_id");

ALTER TABLE "legal_corpus_materializations"
  ADD CONSTRAINT "legal_corpus_materializations_corpus_record_id_fkey"
  FOREIGN KEY ("corpus_record_id") REFERENCES "legal_corpus_records"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "legal_corpus_ingestion_manifest_entries"
  ADD CONSTRAINT "legal_corpus_ingestion_manifest_entries_materialization_id_fkey"
  FOREIGN KEY ("materialization_id") REFERENCES "legal_corpus_materializations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
