-- =========================================================================
--  PHASE 3: POLYGON SUB-DIVISION (500M+ ROWS SCALE)
--
--  Tabeller som migreras:
--    - env.protected_area (Skyddad natur)
--    - env.natura2000_area (Natura 2000)
--    - env.lst_vattenskyddsomrade (Vattenskyddsområden)
--
--  Strategi:
--    1. Byt namn på befintliga tabeller till *_legacy.
--    2. Skapa nya tabeller med samma struktur.
--    3. Använd ST_Subdivide(geom, 256) för att dela upp komplexa polygoner.
--    4. Återskapa GiST-index.
--
--  Körning: psql -U postgres -d miljobeslut -f scripts/db/subdivide-complex-polygons.sql
-- =========================================================================

BEGIN;

-- ── 1. PROTECTED AREA (NVR) ───────────────────────────────────────────────
RAISE NOTICE 'Subdividing env.protected_area...';

ALTER TABLE env.protected_area RENAME TO protected_area_legacy;

CREATE TABLE env.protected_area (
    id SERIAL PRIMARY KEY,
    nvr_id TEXT,
    name TEXT,
    protection_type TEXT,
    decision_status TEXT,
    geom geometry(MultiPolygon, 3006)
);

INSERT INTO env.protected_area (nvr_id, name, protection_type, decision_status, geom)
SELECT 
    nvr_id, name, protection_type, decision_status,
    ST_Multi(ST_Subdivide(geom, 256))
FROM env.protected_area_legacy;

CREATE INDEX idx_protected_area_geom_gist ON env.protected_area USING GIST (geom);
CREATE INDEX idx_protected_area_nvr_id ON env.protected_area (nvr_id);

-- ── 2. NATURA 2000 ────────────────────────────────────────────────────────
RAISE NOTICE 'Subdividing env.natura2000_area...';

ALTER TABLE env.natura2000_area RENAME TO natura2000_area_legacy;

CREATE TABLE env.natura2000_area (
    id SERIAL PRIMARY KEY,
    external_id TEXT,
    site_name TEXT,
    category TEXT,
    geom geometry(MultiPolygon, 3006)
);

INSERT INTO env.natura2000_area (external_id, site_name, category, geom)
SELECT 
    external_id, site_name, category,
    ST_Multi(ST_Subdivide(geom, 256))
FROM env.natura2000_area_legacy;

CREATE INDEX idx_natura2000_area_geom_gist ON env.natura2000_area USING GIST (geom);
CREATE INDEX idx_natura2000_external_id ON env.natura2000_area (external_id);

-- ── 3. VATTENSKYDDSOMRÅDEN ────────────────────────────────────────────────
RAISE NOTICE 'Subdividing env.lst_vattenskyddsomrade...';

-- Kontrollera om tabellen existerar (denna kan variera mellan miljöer)
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'env' AND tablename = 'lst_vattenskyddsomrade') THEN
        ALTER TABLE env.lst_vattenskyddsomrade RENAME TO lst_vattenskyddsomrade_legacy;

        CREATE TABLE env.lst_vattenskyddsomrade (
            id SERIAL PRIMARY KEY,
            ms_id TEXT,
            namn TEXT,
            geom geometry(MultiPolygon, 3006)
        );

        INSERT INTO env.lst_vattenskyddsomrade (ms_id, namn, geom)
        SELECT 
            ms_id, namn,
            ST_Multi(ST_Subdivide(geom, 256))
        FROM env.lst_vattenskyddsomrade_legacy;

        CREATE INDEX idx_vattenskydd_geom_gist ON env.lst_vattenskyddsomrade USING GIST (geom);
    END IF;
END $$;

RAISE NOTICE 'Phase 3 Migration completed successfully.';

COMMIT;
