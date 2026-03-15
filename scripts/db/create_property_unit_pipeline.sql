-- Property unit pipeline for fast exact + fuzzy lookup in PostGIS.
-- Run manually after extensions in scripts/enable_postgis.sql are enabled.

CREATE SCHEMA IF NOT EXISTS stage;
CREATE SCHEMA IF NOT EXISTS core;

-- Force recreate to ensure PostGIS columns exist (Prisma might have created them without geom)
DROP TABLE IF EXISTS stage.property_unit_raw CASCADE;
DROP TABLE IF EXISTS core.property_unit CASCADE;

CREATE OR REPLACE FUNCTION core.normalize_designation(src text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT regexp_replace(
    lower(unaccent(coalesce(src, ''))),
    '[^a-z0-9]',
    '',
    'g'
  );
$$;

COMMENT ON FUNCTION core.normalize_designation(text)
IS 'Normalizes Swedish property designations for exact and fuzzy lookup, e.g. "Örebro 1:23" -> "orebro123".';

CREATE TABLE IF NOT EXISTS stage.property_unit_raw (
  source_key text PRIMARY KEY,
  designation text NOT NULL,
  municipality_code text,
  municipality_name text,
  county_code text,
  geom geometry(MultiPolygon, 3006) NOT NULL,
  raw_properties jsonb NOT NULL DEFAULT '{}'::jsonb,
  imported_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE stage.property_unit_raw
IS 'Staging table for imported Lantmäteriet property unit data before merge into core.property_unit.';

CREATE TABLE IF NOT EXISTS core.property_unit (
  id bigserial PRIMARY KEY,
  source_key text NOT NULL UNIQUE,
  designation text NOT NULL,
  designation_norm text GENERATED ALWAYS AS (core.normalize_designation(designation)) STORED,
  municipality_code text,
  municipality_name text,
  county_code text,
  source_dataset text NOT NULL DEFAULT 'Lantmateriet Fastighetsindelning Direkt',
  source_updated_at timestamptz NOT NULL DEFAULT now(),
  raw_properties jsonb NOT NULL DEFAULT '{}'::jsonb,
  geom geometry(MultiPolygon, 3006) NOT NULL
);

COMMENT ON TABLE core.property_unit
IS 'Canonical property unit table for map click lookup and fast designation search.';

CREATE INDEX IF NOT EXISTS property_unit_designation_norm_btree
  ON core.property_unit (designation_norm);

CREATE INDEX IF NOT EXISTS property_unit_designation_norm_trgm
  ON core.property_unit
  USING GIN (designation_norm gin_trgm_ops);

CREATE INDEX IF NOT EXISTS property_unit_geom_gix
  ON core.property_unit
  USING GIST (geom);

CREATE INDEX IF NOT EXISTS property_unit_municipality_code_idx
  ON core.property_unit (municipality_code);

-- Exact lookup first.
-- Example:
-- WITH q AS (
--   SELECT core.normalize_designation('Örebro 1:23') AS designation_norm
-- )
-- SELECT *
-- FROM core.property_unit pu, q
-- WHERE pu.designation_norm = q.designation_norm
-- LIMIT 1;

-- Fuzzy fallback second.
-- Example:
-- WITH q AS (
--   SELECT core.normalize_designation('orebro1-23') AS designation_norm
-- )
-- SELECT pu.*, similarity(pu.designation_norm, q.designation_norm) AS sim
-- FROM core.property_unit pu, q
-- WHERE pu.designation_norm % q.designation_norm
-- ORDER BY sim DESC
-- LIMIT 1;

-- Point-in-property lookup for map clicks.
-- Example:
-- WITH p AS (
--   SELECT ST_Transform(ST_SetSRID(ST_MakePoint(:lon, :lat), 4326), 3006) AS geom
-- )
-- SELECT pu.*
-- FROM core.property_unit pu, p
-- WHERE pu.geom && p.geom
--   AND ST_Covers(pu.geom, p.geom)
-- LIMIT 1;

-- Merge from staging into core is intentionally separated into:
-- scripts/db/merge_property_unit_stage_to_core.sql
-- so schema setup and data promotion remain distinct, reviewable steps.
