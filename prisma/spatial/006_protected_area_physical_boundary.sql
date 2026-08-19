-- RC6-C — physical boundary for protected areas (NVR).
--
-- Authority: SPATIAL-SCHEMA-OWNERSHIP-01.md §0.5 (decision C) and
-- RC6-C's frozen raw-surface name. Two separate physical surfaces, not one
-- table trying to serve both roles:
--
--   env.protected_area_nvr_raw   source-faithful NVR materialization
--                                 (nvrid, namn, skyddstyp, source-native fields)
--                                 NOT a consumer-facing semantic surface
--
--   env.protected_area           canonical normalized read model
--                                 (nvr_id, name, protection_type, decision_status, ...)
--                                 the only surface application/LU consumers query
--
-- NVR source --(ETL/ogr2ogr, materializer)--> protected_area_nvr_raw
--            --(deterministic normalization, not yet built)--> protected_area
--
-- Recon before writing this (RC6, this session): no application or test
-- consumer reads protected_area_nvr_raw's columns by name today. The
-- "governed LU path" (SpatialProviderPostGIS.ts) only ever issued
-- `SELECT 1 ... WHERE ST_DWithin(geom, ...)` against whatever table name
-- SpatialLayerRegistry bound to "protected_area" -- column-agnostic. Every
-- consumer that reads nvr_id/name/protection_type/decision_status/area_ha
-- already expects the canonical shape. Both test provisioners are updated
-- in RC6-D to build both surfaces; nothing needs to keep reading raw fields
-- until a real materializer exists.

CREATE SCHEMA IF NOT EXISTS env;

-- ---------------------------------------------------------------- raw ----

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'env' AND c.relname = 'protected_area_nvr_raw' AND c.relkind = 'v'
  ) THEN
    EXECUTE 'DROP VIEW env.protected_area_nvr_raw CASCADE';
  END IF;
END $$;

-- Matches production's actual current env.protected_area shape exactly
-- (SPATIAL-SCHEMA-OWNERSHIP-01.md, read-only inspection): ogc_fid, geom,
-- nvrid, namn, skyddstyp. No PK enforced in production today; declared
-- here because ogc_fid is what ogr2ogr already assigns as row identity.
CREATE TABLE IF NOT EXISTS env.protected_area_nvr_raw (
  ogc_fid    INTEGER PRIMARY KEY,
  nvrid      VARCHAR(254),
  namn       VARCHAR(254),
  skyddstyp  VARCHAR(254),
  geom       geometry(MultiPolygon, 3006)
);

CREATE INDEX IF NOT EXISTS idx_protected_area_nvr_raw_geom
  ON env.protected_area_nvr_raw USING gist (geom);

COMMENT ON TABLE env.protected_area_nvr_raw IS
  'Source-faithful NVR materialization (RC6-C, decision C). Not a consumer-facing '
  'surface -- see env.protected_area for the canonical normalized read model. '
  'Populated by ETL/ogr2ogr from Naturvårdsverket; this DDL is the schema authority.';

-- --------------------------------------------------------------- canonical ---

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'env' AND c.relname = 'protected_area' AND c.relkind = 'v'
  ) THEN
    EXECUTE 'DROP VIEW env.protected_area CASCADE';
  END IF;
END $$;

-- Column set is exactly what committed consumers already query (verified by
-- grep across server/services, server/modules/ai/orchestrator, and
-- packages/spatial-provider-postgis before writing this): nvr_id, name,
-- protection_type, decision_status (spatialAuditService.ts), area_ha
-- (nvrService.ts), geom. Single geometry column -- RC6-D converges the two
-- consumers that referenced a second "wkb_geometry" column onto this one,
-- rather than this table carrying two geometry columns to avoid touching them.
CREATE TABLE IF NOT EXISTS env.protected_area (
  nvr_id          TEXT PRIMARY KEY,
  name            TEXT,
  protection_type TEXT,
  decision_status TEXT,
  source_dataset  TEXT,
  geom            geometry(MultiPolygon, 3006),
  area_ha         DOUBLE PRECISION GENERATED ALWAYS AS (ST_Area(geom) / 10000.0) STORED
);

CREATE INDEX IF NOT EXISTS idx_protected_area_geom
  ON env.protected_area USING gist (geom);

COMMENT ON TABLE env.protected_area IS
  'Canonical normalized read model (RC6-C, decision C). Consumer-facing. '
  'Populated by an explicit, deterministic normalization from '
  'env.protected_area_nvr_raw -- not yet built; RC6 scope is the schema '
  'contract and consumer convergence, not the materializer.';
