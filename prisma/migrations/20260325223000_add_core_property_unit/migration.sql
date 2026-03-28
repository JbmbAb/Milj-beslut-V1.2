-- Add minimal PostGIS + pg_trgm primitives required by property lookups.
--
-- This migration ensures integration tests and services relying on:
-- - core.property_unit
-- - core.normalize_designation(text)
-- - pg_trgm (% operator, similarity())
-- can run against a fresh database.

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE SCHEMA IF NOT EXISTS core;

CREATE OR REPLACE FUNCTION core.normalize_designation(input text) RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT regexp_replace(
    upper(trim(input)),
    '(\\d+)\\s+(\\d+)$',
    '\\1:\\2'
  );
$$;

CREATE TABLE IF NOT EXISTS core.property_unit (
  source_key text PRIMARY KEY,
  designation text NOT NULL,
  designation_norm text NOT NULL,
  municipality_code text,
  municipality_name text,
  county_code text,
  source_dataset text NOT NULL,
  source_updated_at timestamptz DEFAULT now(),
  raw_properties jsonb,
  geom geometry(Geometry, 4326) NOT NULL
);

CREATE INDEX IF NOT EXISTS property_unit_designation_norm_idx
  ON core.property_unit (designation_norm);

CREATE INDEX IF NOT EXISTS property_unit_designation_norm_trgm_idx
  ON core.property_unit USING gin (designation_norm gin_trgm_ops);

CREATE INDEX IF NOT EXISTS property_unit_geom_gist_idx
  ON core.property_unit USING gist (geom);
