-- =============================================================================
-- Migration: Raster Out-of-DB — spårningstabell + spatial index
-- Mimers Brunn — Raster Pipeline
--
-- Tabellen registrerar alla Out-of-DB raster-filer som pekar mot
-- GEO_Master_Archive. PostGIS-tabellerna i public.raster_<provider>_<dataset>
-- innehåller raster-band med externa filreferenser (raster2pgsql -R).
-- =============================================================================

-- 1. Aktivera PostGIS raster-tillägg (krävs för Out-of-DB)
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS postgis_raster;

-- 2. Tillåt Out-of-DB raster-filer (säkerhetsinställning)
--    OBS: Sätts per session i applikationen, men aktiveras globalt här.
SET postgis.enable_outdb_rasters = true;
ALTER SYSTEM SET postgis.enable_outdb_rasters = true;
SELECT pg_reload_conf();

-- 3. Spårningstabell — ett register över alla registrerade raster-filer
CREATE TABLE IF NOT EXISTS public.raster_registration_log (
  id             SERIAL       PRIMARY KEY,
  provider       TEXT         NOT NULL,
  dataset        TEXT         NOT NULL,
  version        TEXT         NOT NULL,
  -- Sökväg relativt MASTER_ARCHIVE_ROOT (portabel mellan maskiner)
  file_path      TEXT         NOT NULL UNIQUE,
  -- SHA-256 av filen — bevis på integritet (Mimers Brunn-krav)
  sha256         TEXT,
  size_bytes     BIGINT,
  epsg_code      INTEGER      DEFAULT 3006,
  tile_size      TEXT         DEFAULT '256x256',
  -- PostGIS-tabell som håller Out-of-DB-referenserna
  table_ref      TEXT         NOT NULL,
  -- Metadata från raster-filen (bbox, antal band, pixelstorlek)
  bbox_wkt       TEXT,
  band_count     INTEGER,
  pixel_width    FLOAT8,
  pixel_height   FLOAT8,
  -- Räkna antalet raster-tiles som registrerades
  tile_count     INTEGER,
  registered_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.raster_registration_log IS
  'Mimers Brunn — spårning av Out-of-DB raster-filer registrerade i PostGIS. Filerna lagras fysiskt i GEO_Master_Archive, PostGIS pekar med externa referenser.';

-- Index för vanliga querymönster
CREATE INDEX IF NOT EXISTS idx_raster_log_provider_dataset
  ON public.raster_registration_log (provider, dataset);

CREATE INDEX IF NOT EXISTS idx_raster_log_registered_at
  ON public.raster_registration_log (registered_at DESC);

-- 4. Vy — enkel status-vy för audit och monitoring
CREATE OR REPLACE VIEW public.raster_registration_status AS
SELECT
  provider,
  dataset,
  version,
  COUNT(*)                                AS file_count,
  SUM(size_bytes)                         AS total_bytes,
  SUM(tile_count)                         AS total_tiles,
  COUNT(*) FILTER (WHERE sha256 IS NULL)  AS missing_sha256,
  MAX(registered_at)                      AS last_registered
FROM public.raster_registration_log
GROUP BY provider, dataset, version
ORDER BY provider, dataset;

COMMENT ON VIEW public.raster_registration_status IS
  'Audit-vy: visar registreringsstatus per provider/dataset. missing_sha256 = 0 är ett krav för Definition of Done (Mimers Brunn).';
