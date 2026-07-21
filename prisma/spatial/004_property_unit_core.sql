-- Affärslager för fastighetsuppslag (core.property_unit).
-- Materialiseras från env.registerenhetsomradesytor via scripts/db/sync-property-unit-from-env.ts
-- efter varje promote av registerenhetsomradesytor.

CREATE SCHEMA IF NOT EXISTS core;

CREATE OR REPLACE FUNCTION core.normalize_designation(input text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $function$
BEGIN
  RETURN UPPER(REGEXP_REPLACE(UNACCENT(input), '[^a-zA-Z0-9:]', '', 'g'));
END;
$function$;

CREATE OR REPLACE FUNCTION core.trg_property_unit_normalize()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.designation_norm := core.normalize_designation(NEW.designation);
  RETURN NEW;
END;
$function$;

-- Vyn eller tidigare tabell ersätts av fysisk tabell vid sync.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'core' AND c.relname = 'property_unit' AND c.relkind = 'v'
  ) THEN
    EXECUTE 'DROP VIEW core.property_unit CASCADE';
  ELSIF EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'core' AND c.relname = 'property_unit' AND c.relkind = 'r'
  ) THEN
    EXECUTE 'DROP TABLE core.property_unit CASCADE';
  END IF;
END $$;

CREATE TABLE core.property_unit (
  id SERIAL PRIMARY KEY,
  source_key TEXT NOT NULL UNIQUE,
  designation TEXT NOT NULL,
  designation_norm TEXT NOT NULL,
  municipality_code TEXT,
  municipality_name TEXT,
  county_code TEXT,
  source_dataset TEXT NOT NULL,
  source_updated_at TIMESTAMPTZ,
  raw_properties JSONB,
  geom geometry(MultiPolygon, 3006)
);

DROP TRIGGER IF EXISTS property_unit_normalize_trg ON core.property_unit;
CREATE TRIGGER property_unit_normalize_trg
  BEFORE INSERT OR UPDATE OF designation ON core.property_unit
  FOR EACH ROW
  EXECUTE FUNCTION core.trg_property_unit_normalize();

CREATE INDEX IF NOT EXISTS property_unit_designation_norm_idx
  ON core.property_unit (designation_norm);

CREATE INDEX IF NOT EXISTS property_unit_designation_norm_trgm_idx
  ON core.property_unit USING gin (designation_norm gin_trgm_ops);

CREATE INDEX IF NOT EXISTS property_unit_geom_gist_idx
  ON core.property_unit USING gist (geom);

CREATE INDEX IF NOT EXISTS property_unit_municipality_name_idx
  ON core.property_unit (municipality_name);

COMMENT ON TABLE core.property_unit IS
  'Materialiserat affärslager för POST /api/property/lookup. Synkas från env.registerenhetsomradesytor.';
