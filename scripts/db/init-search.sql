DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'vector') THEN
    CREATE EXTENSION IF NOT EXISTS vector;
  ELSE
    RAISE NOTICE 'pgvector extension not installed on this PostgreSQL host. Skipping vector setup.';
  END IF;
END
$$;

CREATE EXTENSION IF NOT EXISTS pg_trgm;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'vector') THEN
    ALTER TABLE "DocumentChunk"
    ADD COLUMN IF NOT EXISTS "embeddingVector" vector(768);

    -- Backfill vector column from existing JSON embeddings so pgvector can be used immediately.
    UPDATE "DocumentChunk"
    SET "embeddingVector" = (
      '[' ||
      array_to_string(
        ARRAY(
          SELECT jsonb_array_elements_text("embeddingJson"::jsonb)
        ),
        ','
      ) ||
      ']'
    )::vector
    WHERE "embeddingVector" IS NULL
      AND "embeddingJson" IS NOT NULL;

    CREATE INDEX IF NOT EXISTS "DocumentChunk_embeddingVector_ivfflat_idx"
    ON "DocumentChunk"
    USING ivfflat ("embeddingVector" vector_cosine_ops)
    WITH (lists = 100);
  ELSE
    RAISE NOTICE 'Vector type is unavailable; leaving JSON embedding fallback active.';
  END IF;
END
$$;
