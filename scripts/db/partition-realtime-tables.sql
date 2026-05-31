-- =========================================================================
--  TIME-SERIES PARTITIONING MIGRATION (500M+ ROWS SCALE)
--
--  Tabeller som migreras:
--    - GpsPosition
--    - AuditTrail
--    - SearchQueryLog
--    - PropertyAccessLog
--
--  Strategi:
--    1. Byt namn på befintliga tabeller till *_legacy.
--    2. Skapa nya partitionerade tabeller (PARTITION BY RANGE).
--    3. Skapa månadspartitioner för 2024, 2025 och 2026.
--    4. Kopiera över data från *_legacy till de nya tabellerna (Cutover).
--
--  Körning: psql -U postgres -d miljobeslut -f scripts/db/partition-realtime-tables.sql
-- =========================================================================

-- Säkerställ att vi kör allt i en transaktion om datamängden tillåter.
-- För massiva dataset (>100M) kan denna behöva brytas ut till batchad kopiering.
BEGIN;

-- =========================================================================
-- 1. GPS POSITION (Mest kritisk, högst frekvens)
-- =========================================================================
RAISE NOTICE 'Migrating GpsPosition...';

-- Byt namn på nuvarande
ALTER TABLE "public"."GpsPosition" RENAME TO "GpsPosition_legacy";
ALTER INDEX IF EXISTS "GpsPosition_pkey" RENAME TO "GpsPosition_legacy_pkey";
ALTER INDEX IF EXISTS "GpsPosition_bookingId_timestamp_idx" RENAME TO "GpsPosition_legacy_bookingId_timestamp_idx";

-- Skapa ny partitionerad tabell. Primärnyckeln MÅSTE inkludera timestamp för RANGE partitioning.
CREATE TABLE "public"."GpsPosition" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "altitude" DOUBLE PRECISION,
    "speedKmh" DOUBLE PRECISION,
    "heading" DOUBLE PRECISION,
    "accuracy" DOUBLE PRECISION,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "hash" TEXT NOT NULL,
    "prevHash" TEXT,
    
    CONSTRAINT "GpsPosition_pkey" PRIMARY KEY ("id", "timestamp"),
    CONSTRAINT "GpsPosition_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "public"."TransportBooking"("id") ON DELETE CASCADE ON UPDATE CASCADE
) PARTITION BY RANGE ("timestamp");

-- Skapa index
CREATE INDEX "GpsPosition_bookingId_timestamp_idx" ON "public"."GpsPosition"("bookingId", "timestamp");
CREATE INDEX "GpsPosition_brin_timestamp_idx" ON "public"."GpsPosition" USING BRIN ("timestamp") WITH (pages_per_range = 128);

-- =========================================================================
-- 2. AUDIT TRAIL
-- =========================================================================
RAISE NOTICE 'Migrating AuditTrail...';

ALTER TABLE "public"."AuditTrail" RENAME TO "AuditTrail_legacy";
ALTER INDEX IF EXISTS "AuditTrail_pkey" RENAME TO "AuditTrail_legacy_pkey";
ALTER INDEX IF EXISTS "AuditTrail_chainHash_key" RENAME TO "AuditTrail_legacy_chainHash_key";
ALTER INDEX IF EXISTS "AuditTrail_reference_number_idx" RENAME TO "AuditTrail_legacy_reference_number_idx";
ALTER INDEX IF EXISTS "AuditTrail_entityType_timestamp_idx" RENAME TO "AuditTrail_legacy_entityType_timestamp_idx";

CREATE TABLE "public"."AuditTrail" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "userId" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reference_number" TEXT,
    "payloadHash" TEXT NOT NULL,
    "prevHash" TEXT,
    "chainHash" TEXT NOT NULL,
    
    CONSTRAINT "AuditTrail_pkey" PRIMARY KEY ("id", "timestamp"),
    CONSTRAINT "AuditTrail_chainHash_key" UNIQUE ("chainHash", "timestamp")
) PARTITION BY RANGE ("timestamp");

CREATE INDEX "AuditTrail_reference_number_idx" ON "public"."AuditTrail"("reference_number");
CREATE INDEX "AuditTrail_entityType_timestamp_idx" ON "public"."AuditTrail"("entityType", "timestamp");
CREATE INDEX "AuditTrail_brin_timestamp_idx" ON "public"."AuditTrail" USING BRIN ("timestamp") WITH (pages_per_range = 128);

-- =========================================================================
-- 3. SEARCH QUERY LOG
-- =========================================================================
RAISE NOTICE 'Migrating SearchQueryLog...';

ALTER TABLE "public"."SearchQueryLog" RENAME TO "SearchQueryLog_legacy";
ALTER INDEX IF EXISTS "SearchQueryLog_pkey" RENAME TO "SearchQueryLog_legacy_pkey";
ALTER INDEX IF EXISTS "SearchQueryLog_projectId_createdAt_idx" RENAME TO "SearchQueryLog_legacy_projectId_createdAt_idx";
ALTER INDEX IF EXISTS "SearchQueryLog_userId_createdAt_idx" RENAME TO "SearchQueryLog_legacy_userId_createdAt_idx";

CREATE TABLE "public"."SearchQueryLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "mode" "public"."SearchMode" NOT NULL DEFAULT 'hybrid',
    "topK" INTEGER NOT NULL DEFAULT 20,
    "resultCount" INTEGER NOT NULL DEFAULT 0,
    "elapsedMs" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT "SearchQueryLog_pkey" PRIMARY KEY ("id", "createdAt"),
    CONSTRAINT "SearchQueryLog_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "public"."Project"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SearchQueryLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
) PARTITION BY RANGE ("createdAt");

CREATE INDEX "SearchQueryLog_projectId_createdAt_idx" ON "public"."SearchQueryLog"("projectId", "createdAt");
CREATE INDEX "SearchQueryLog_userId_createdAt_idx" ON "public"."SearchQueryLog"("userId", "createdAt");
CREATE INDEX "SearchQueryLog_brin_createdAt_idx" ON "public"."SearchQueryLog" USING BRIN ("createdAt") WITH (pages_per_range = 128);

-- =========================================================================
-- 4. PROPERTY ACCESS LOG
-- =========================================================================
RAISE NOTICE 'Migrating PropertyAccessLog...';

ALTER TABLE "public"."PropertyAccessLog" RENAME TO "PropertyAccessLog_legacy";
ALTER INDEX IF EXISTS "PropertyAccessLog_pkey" RENAME TO "PropertyAccessLog_legacy_pkey";
ALTER INDEX IF EXISTS "PropertyAccessLog_projectId_timestamp_idx" RENAME TO "PropertyAccessLog_legacy_projectId_timestamp_idx";
ALTER INDEX IF EXISTS "PropertyAccessLog_userId_timestamp_idx" RENAME TO "PropertyAccessLog_legacy_userId_timestamp_idx";

CREATE TABLE "public"."PropertyAccessLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "propertyDesignation" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "purpose" TEXT NOT NULL,
    "responseClass" "public"."PropertyResponseClass" NOT NULL,
    
    CONSTRAINT "PropertyAccessLog_pkey" PRIMARY KEY ("id", "timestamp"),
    CONSTRAINT "PropertyAccessLog_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "public"."Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PropertyAccessLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
) PARTITION BY RANGE ("timestamp");

CREATE INDEX "PropertyAccessLog_projectId_timestamp_idx" ON "public"."PropertyAccessLog"("projectId", "timestamp");
CREATE INDEX "PropertyAccessLog_userId_timestamp_idx" ON "public"."PropertyAccessLog"("userId", "timestamp");
CREATE INDEX "PropertyAccessLog_brin_timestamp_idx" ON "public"."PropertyAccessLog" USING BRIN ("timestamp") WITH (pages_per_range = 128);

-- =========================================================================
-- PARTITION GENERATION (2024 - 2026)
-- =========================================================================
DO $$
DECLARE
    y INT;
    m INT;
    start_date TEXT;
    end_date TEXT;
    part_suffix TEXT;
BEGIN
    FOR y IN 2024..2026 LOOP
        FOR m IN 1..12 LOOP
            start_date := format('%s-%s-01', y, lpad(m::text, 2, '0'));
            IF m = 12 THEN
                end_date := format('%s-01-01', y + 1);
            ELSE
                end_date := format('%s-%s-01', y, lpad((m + 1)::text, 2, '0'));
            END IF;
            
            part_suffix := format('y%sm%s', y, lpad(m::text, 2, '0'));
            
            -- GpsPosition
            EXECUTE format('CREATE TABLE IF NOT EXISTS "public"."GpsPosition_%s" PARTITION OF "public"."GpsPosition" FOR VALUES FROM (%L) TO (%L);', part_suffix, start_date, end_date);
            
            -- AuditTrail
            EXECUTE format('CREATE TABLE IF NOT EXISTS "public"."AuditTrail_%s" PARTITION OF "public"."AuditTrail" FOR VALUES FROM (%L) TO (%L);', part_suffix, start_date, end_date);
            
            -- SearchQueryLog
            EXECUTE format('CREATE TABLE IF NOT EXISTS "public"."SearchQueryLog_%s" PARTITION OF "public"."SearchQueryLog" FOR VALUES FROM (%L) TO (%L);', part_suffix, start_date, end_date);
            
            -- PropertyAccessLog
            EXECUTE format('CREATE TABLE IF NOT EXISTS "public"."PropertyAccessLog_%s" PARTITION OF "public"."PropertyAccessLog" FOR VALUES FROM (%L) TO (%L);', part_suffix, start_date, end_date);
        END LOOP;
    END LOOP;
END $$;

-- Default partitions (Catch-all for dates outside generated ranges)
CREATE TABLE IF NOT EXISTS "public"."GpsPosition_default" PARTITION OF "public"."GpsPosition" DEFAULT;
CREATE TABLE IF NOT EXISTS "public"."AuditTrail_default" PARTITION OF "public"."AuditTrail" DEFAULT;
CREATE TABLE IF NOT EXISTS "public"."SearchQueryLog_default" PARTITION OF "public"."SearchQueryLog" DEFAULT;
CREATE TABLE IF NOT EXISTS "public"."PropertyAccessLog_default" PARTITION OF "public"."PropertyAccessLog" DEFAULT;

-- =========================================================================
-- DATA TRANSFER
-- =========================================================================
RAISE NOTICE 'Copying data to partitioned tables. This may take time...';

INSERT INTO "public"."GpsPosition" 
SELECT * FROM "GpsPosition_legacy";

INSERT INTO "public"."AuditTrail" 
SELECT * FROM "AuditTrail_legacy";

INSERT INTO "public"."SearchQueryLog" 
SELECT * FROM "SearchQueryLog_legacy";

INSERT INTO "public"."PropertyAccessLog" 
SELECT * FROM "PropertyAccessLog_legacy";

RAISE NOTICE 'Migration completed successfully.';

COMMIT;
