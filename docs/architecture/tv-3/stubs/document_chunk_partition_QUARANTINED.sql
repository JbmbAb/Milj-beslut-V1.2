-- TV-3 DESIGN STUB — NOT A PRISMA MIGRATION — DO NOT APPLY
-- QUARANTINED under TV-3.0 PHYS-I02: document_chunk partitioning deferred to TV-3.3.
-- Reason: partitions by created_at without access-pattern proof; conflicts with
-- "No partition without access-pattern proof" and ANN/recovery gates in TV-3.2.
-- Canonical policy: docs/architecture/TV-3.0-PostgreSQL-Physical-Data-Strategy-Freeze.md
-- Design drafts: docs/architecture/TV-3.1-Table-Definition-Drafts.md
--
-- Historical conceptual sketch (kept for reference only):

-- This is a conceptual migration to convert DocumentChunk into a natively partitioned table in Postgres.
-- In a real scenario, this requires a blue/green table swap because you cannot easily convert an
-- existing table to a partitioned table in-place if it already has foreign keys and data.

-- 1. Rename existing table
ALTER TABLE "DocumentChunk" RENAME TO "DocumentChunk_Legacy";

-- 2. Create the new partitioned table (partitioned by range on created_at)
CREATE TABLE "DocumentChunk" (
    "id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "chunk_index" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    -- Primary key must include the partition key
    PRIMARY KEY ("id", "created_at")
) PARTITION BY RANGE ("created_at");

-- 3. Create partitions for the current and previous year (hot data)
CREATE TABLE "DocumentChunk_2025" PARTITION OF "DocumentChunk"
    FOR VALUES FROM ('2025-01-01 00:00:00') TO ('2026-01-01 00:00:00');

CREATE TABLE "DocumentChunk_2026" PARTITION OF "DocumentChunk"
    FOR VALUES FROM ('2026-01-01 00:00:00') TO ('2027-01-01 00:00:00');

-- 4. Create an archive partition for everything older
CREATE TABLE "DocumentChunk_Archive" PARTITION OF "DocumentChunk"
    FOR VALUES FROM (MINVALUE) TO ('2025-01-01 00:00:00');

-- 5. Copy data (This would take time in production)
-- INSERT INTO "DocumentChunk" SELECT * FROM "DocumentChunk_Legacy";

-- 6. Add indexes
CREATE INDEX "DocumentChunk_document_id_idx" ON "DocumentChunk"("document_id");
CREATE INDEX "DocumentChunk_created_at_idx" ON "DocumentChunk"("created_at");

-- Note: Foreign keys referencing DocumentChunk from other tables will need to be
-- dropped and recreated, as Postgres partitioning has strict rules about FKs
-- referencing partitioned tables (they must reference the exact PK including the partition key).
