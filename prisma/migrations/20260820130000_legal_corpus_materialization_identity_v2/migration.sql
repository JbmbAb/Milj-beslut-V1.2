-- LEGAL-CORPUS-MATERIALIZATION-IDENTITY-V2
-- chunk_policy_version is identity-bearing for a materialization: a different chunk policy
-- produces a different canonical chunk set (ChunkIdentity v2's own chunk_set_content_hash
-- already treats it this way), so the materialization that owns that chunk set must be a
-- distinct row too, or a rechunk would collide onto the old materialization instead of
-- producing new, separate, immutable history.
--
-- Discovered via the real F2 replay/rechunk proof against the live database: the app-level
-- canonicalRecordKey hash was updated first and correctly diverged per chunk policy, but this
-- table's own compound uniqueness constraint did not include chunk_policy_version, so the
-- database itself still rejected two legitimately distinct materializations that only differ by
-- chunk policy.
--
-- Existing rows (proof/test data only, no real acquired content yet) get a temporary default so
-- the NOT NULL column can be added without a backfill query; the default is dropped immediately
-- after so every future row must supply a real value.

ALTER TABLE "legal_corpus_materializations" ADD COLUMN "chunk_policy_version" TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE "legal_corpus_materializations" ALTER COLUMN "chunk_policy_version" DROP DEFAULT;

DROP INDEX "legal_corpus_materializations_identity_key";
CREATE UNIQUE INDEX "legal_corpus_materializations_identity_key"
  ON "legal_corpus_materializations"("logical_source_id", "registry_artifact_id", "raw_source_content_hash", "text_projection_hash", "text_projection_version", "corpus_materialization_version", "chunk_policy_version");
