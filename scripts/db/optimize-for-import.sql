-- ================================================================
--  PostgreSQL: Optimering för bulk-import 100M–500M rader
--  Kör INNAN import startar (som superuser eller pg-ägare)
--  psql -U postgres -d miljobeslut -f scripts/db/optimize-for-import.sql
-- ================================================================

-- ── SESSION-NIVÅ (gäller bara denna session) ─────────────────────
-- Öka work-memory kraftigt för index-bygge
SET maintenance_work_mem = '4GB';
SET work_mem = '256MB';

-- Stäng av synkron commit – WAL skrivs async = 3–5x snabbare INSERT/COPY
-- Datarisk: max ~0.6s data vid krasch (acceptabelt för import)
SET synchronous_commit = OFF;

-- Parallella workers för VACUUM ANALYZE och index-bygge
SET max_parallel_maintenance_workers = 4;
SET max_parallel_workers_per_gather   = 4;

-- Längre statement-timeout för ogr2ogr-sessioner (8 timmar)
SET statement_timeout = '28800000';
SET lock_timeout      = '300000';

-- ── SERVER-NIVÅ TIPS (kräver restart eller reload) ────────────────
-- Sätt dessa i postgresql.conf och kör SELECT pg_reload_conf():
--
--   checkpoint_completion_target = 0.9
--   wal_buffers                  = 256MB
--   shared_buffers               = 4GB          -- 25% av RAM
--   effective_cache_size         = 12GB         -- 75% av RAM
--   random_page_cost             = 1.1          -- SSD-optimerat
--   max_wal_size                 = 8GB
--   min_wal_size                 = 2GB
--   autovacuum                   = off          -- stäng av under import
--   fsync                        = on           -- håll PÅ för säkerhet

-- ── STÄNG AV AUTOVACUUM UNDER IMPORT ────────────────────────────
-- Förhindrar att autovacuum stjäl I/O under import
ALTER SYSTEM SET autovacuum = off;
SELECT pg_reload_conf();

-- Bekräfta inställningar
SELECT name, setting, unit, context
FROM pg_settings
WHERE name IN (
  'maintenance_work_mem', 'work_mem', 'synchronous_commit',
  'max_parallel_maintenance_workers', 'autovacuum',
  'checkpoint_completion_target', 'wal_buffers', 'max_wal_size'
)
ORDER BY name;
