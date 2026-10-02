-- U30F2 H1 (PRES-05): RETIRED. Refused twice: here (psql stops on the error) and right after BEGIN below
-- (any client that continues on errors runs the rest in an aborted transaction; COMMIT becomes ROLLBACK).
\set ON_ERROR_STOP on
DO $$ BEGIN RAISE EXCEPTION 'REJECT_RETIRED_DESTRUCTIVE_SCRIPT: scripts/db/create_extended_schemas.sql is retired (U30F2 H1): it creates protected LU relations (env.registerenhetsomradesytor, env.sgu_well, climate.flood_risk_area) outside the governed import path; see RETIRED_DESTRUCTIVE_SCRIPTS in packages/spatial-provider-postgis/src/ProtectedRelationGate.ts'; END $$;
-- PostGIS extended schema (reference)
--
-- Versionerad SQL utöver Prisma-migration 20260512194513_gis_schemas_and_stubs.
-- Kör efter `prisma migrate deploy` i miljöer som behöver fullständigare env/core-stubs:
--
--   npx prisma db execute --file scripts/db/create_extended_schemas.sql
--
-- Tabeller skapas med IF NOT EXISTS — säker att köra upprepade gånger.
-- Produktionstabeller fylls via Mimers Brunn manifest-pipeline (import-librarian-manifest.ts).

BEGIN;
DO $$ BEGIN RAISE EXCEPTION 'REJECT_RETIRED_DESTRUCTIVE_SCRIPT: scripts/db/create_extended_schemas.sql is retired (U30F2 H1): it creates protected LU relations (env.registerenhetsomradesytor, env.sgu_well, climate.flood_risk_area) outside the governed import path; see RETIRED_DESTRUCTIVE_SCRIPTS in packages/spatial-provider-postgis/src/ProtectedRelationGate.ts'; END $$;
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE SCHEMA IF NOT EXISTS env;
CREATE SCHEMA IF NOT EXISTS core;
CREATE SCHEMA IF NOT EXISTS topo10;
CREATE SCHEMA IF NOT EXISTS climate;
CREATE SCHEMA IF NOT EXISTS lm_staging;

-- Lantmäteriet / fastighet
CREATE TABLE IF NOT EXISTS env.registerenhetsomradesytor (
  id SERIAL PRIMARY KEY,
  geom geometry(MultiPolygon, 3006)
);
CREATE INDEX IF NOT EXISTS idx_registerenhetsomradesytor_geom
  ON env.registerenhetsomradesytor USING GIST (geom);

CREATE TABLE IF NOT EXISTS env.registerenhetsomradeslinjer (
  id SERIAL PRIMARY KEY,
  geom geometry(MultiLineString, 3006)
);
CREATE INDEX IF NOT EXISTS idx_registerenhetsomradeslinjer_geom
  ON env.registerenhetsomradeslinjer USING GIST (geom);

-- MSB / stabilitet & översvämning
CREATE TABLE IF NOT EXISTS env.msb_pfra_pastevent (
  id SERIAL PRIMARY KEY,
  geom geometry(Geometry, 3006)
);
CREATE INDEX IF NOT EXISTS idx_msb_pfra_pastevent_geom ON env.msb_pfra_pastevent USING GIST (geom);

CREATE TABLE IF NOT EXISTS env.msb_stora_olyckor (
  id SERIAL PRIMARY KEY,
  geom geometry(Geometry, 3006)
);
CREATE INDEX IF NOT EXISTS idx_msb_stora_olyckor_geom ON env.msb_stora_olyckor USING GIST (geom);

CREATE TABLE IF NOT EXISTS env.msb_stabilitetszon (
  id SERIAL PRIMARY KEY,
  geom geometry(Geometry, 3006)
);
CREATE INDEX IF NOT EXISTS idx_msb_stabilitetszon_geom ON env.msb_stabilitetszon USING GIST (geom);

CREATE TABLE IF NOT EXISTS climate.flood_risk_area (
  id SERIAL PRIMARY KEY,
  geom geometry(Geometry, 3006)
);
CREATE INDEX IF NOT EXISTS idx_flood_risk_area_geom ON climate.flood_risk_area USING GIST (geom);

-- SGU (produktfokus)
CREATE TABLE IF NOT EXISTS env.sgu_well (
  id SERIAL PRIMARY KEY,
  geom geometry(Point, 3006)
);
CREATE INDEX IF NOT EXISTS idx_sgu_well_geom ON env.sgu_well USING GIST (geom);

CREATE TABLE IF NOT EXISTS env.sgu_jorddjupsmodell_10m (
  id SERIAL PRIMARY KEY,
  geom geometry(Geometry, 3006)
);

CREATE TABLE IF NOT EXISTS env.sgu_jorddjupsmodell_bergyta_50m (
  id SERIAL PRIMARY KEY,
  geom geometry(Geometry, 3006)
);

CREATE TABLE IF NOT EXISTS env.sgu_fastmark_stabilitet (
  id SERIAL PRIMARY KEY,
  geom geometry(Geometry, 3006)
);

CREATE TABLE IF NOT EXISTS env.sgu_aktsamhet_efterarbetad (
  id SERIAL PRIMARY KEY,
  geom geometry(Geometry, 3006)
);

CREATE TABLE IF NOT EXISTS env.env_sgu_grundvatten_sarbarhet (
  id SERIAL PRIMARY KEY,
  geom geometry(Geometry, 3006)
);

-- Hydro / recipient
CREATE TABLE IF NOT EXISTS env.svaro_2016 (
  id SERIAL PRIMARY KEY,
  geom geometry(Geometry, 3006)
);
CREATE INDEX IF NOT EXISTS idx_svaro_2016_geom ON env.svaro_2016 USING GIST (geom);

CREATE TABLE IF NOT EXISTS env.viss_sw_varo_risk (
  id SERIAL PRIMARY KEY,
  geom geometry(Geometry, 3006)
);

-- Staging (manifest ingester)
-- lm_staging.{table}_{hash} skapas dynamiskt av import-librarian-manifest.ts
COMMIT;
