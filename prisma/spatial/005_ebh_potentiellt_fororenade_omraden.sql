-- RC6-A — canonical spatial DDL for env.ebh_potentiellt_fororenade_omraden.
--
-- Authority: SPATIAL-SCHEMA-OWNERSHIP-01.md — env is owned by this versioned
-- spatial DDL chain, not by ogr2ogr/ETL and not by test provisioning.
--
-- fid is the canonical identity column. This was verified, not assumed:
--   - production's actual table (inspected read-only, SPATIAL-SCHEMA-OWNERSHIP-01.md §2a)
--     has fid, no id column exists there at all
--   - scripts/db/provision-spatial-test-db.ts already provisions fid
--   - every committed spatial/LU consumer (SpatialProviderPostGIS.test.ts,
--     LUMagicMomentPostGIS.test.ts, LUMagicMomentE2E.chain.test.ts,
--     LUEnforcement.test.ts) already queries fid
-- The only place "id" ever appeared for this table was
-- tests/setup/seedGisStubs.ts's own invented stub (RC6-B fixes that).
--
-- Column set matches production's real shape (SPATIAL-SCHEMA-OWNERSHIP-01.md
-- §"env.ebh_potentiellt_fororenade_omraden ... governed layer ebh"), so that
-- a cold-start from this DDL reproduces what production actually has, not a
-- convenient subset.
--
-- Production itself does not currently enforce fid as a PRIMARY KEY (no PK
-- exists there today). This DDL declares fid PRIMARY KEY because that is
-- what the canonical identity decision means, and it is what
-- provision-spatial-test-db.ts already assumed. This is a schema CONTRACT
-- proof, not a production migration: no production data is touched by this
-- file. Applying it to production (if ever) is a separate, later decision.

CREATE SCHEMA IF NOT EXISTS env;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'env' AND c.relname = 'ebh_potentiellt_fororenade_omraden' AND c.relkind = 'v'
  ) THEN
    EXECUTE 'DROP VIEW env.ebh_potentiellt_fororenade_omraden CASCADE';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS env.ebh_potentiellt_fororenade_omraden (
  fid            INTEGER PRIMARY KEY,
  ebh_id         BIGINT,
  n              BIGINT,
  e              BIGINT,
  kommun         VARCHAR(30),
  lan            VARCHAR(30),
  p_bransch      VARCHAR(254),
  s_bransch      VARCHAR(254),
  fastighet      BIGINT,
  preciserad     VARCHAR(29),
  riskklass      VARCHAR(254),
  status         VARCHAR(254),
  geom           geometry(MultiPoint, 3006)
);

CREATE INDEX IF NOT EXISTS idx_ebh_potentiellt_fororenade_omraden_geom
  ON env.ebh_potentiellt_fororenade_omraden USING gist (geom);

COMMENT ON TABLE env.ebh_potentiellt_fororenade_omraden IS
  'Canonical identity column is fid (RC6-A). Populated by ETL/ogr2ogr from the '
  'Länsstyrelsen EBH source; this DDL is the schema authority, ETL is a materializer only.';
