-- =========================================================================
--  PHASE 2: SPATIAL GRID PARTITIONING (100M+ ROWS SCALE)
--
--  Tabeller som migreras:
--    - env.registerenhetsomradesytor (Fastighetsgränser)
--    - core.lm_mark (Topografi mark)
--    - core.lm_byggnad (Topografi byggnader)
--
--  Strategi:
--    1. Skapa en spatial grid-beräkningsfunktion.
--    2. Byt namn på befintliga tabeller till *_legacy.
--    3. Skapa nya partitionerade tabeller (PARTITION BY LIST på grid_id).
--    4. Generera partitioner för hela Sverige (100km rutor).
--    5. Kopiera data och beräkna grid_id on-the-fly.
--
--  Körning: psql -U postgres -d miljobeslut -f scripts/db/partition-spatial-grid.sql
-- =========================================================================

BEGIN;

-- ── 1. GRID BERÄKNINGSFUNKTION ──────────────────────────────────────────
-- Beräknar en unik ID för en 100x100km ruta i SWEREF99 TM (EPSG:3006).
-- X täcker 200k - 900k, Y täcker 6100k - 7700k.
CREATE OR REPLACE FUNCTION public.get_spatial_grid_id(geom geometry)
RETURNS int AS $$
BEGIN
    -- Vi använder ST_Centroid för att placera objektet i en ruta baserat på dess mittpunkt.
    -- Grid-formel: (floor(X/100000)*100 + floor(Y/100000))
    RETURN (floor(ST_X(ST_Centroid(geom))/100000)*100 + floor(ST_Y(ST_Centroid(geom))/100000))::int;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ── 2. REGISTERENHETSOMRADESYTOR (FASTIGHETER) ───────────────────────────
RAISE NOTICE 'Migrating env.registerenhetsomradesytor...';

ALTER TABLE env.registerenhetsomradesytor RENAME TO registerenhetsomradesytor_legacy;

CREATE TABLE env.registerenhetsomradesytor (
    id SERIAL,
    objekt_id TEXT NOT NULL,
    externid TEXT,
    fastighet_id TEXT,
    objekt_version INT,
    detaljtyp TEXT,
    kommunnamn TEXT,
    trakt TEXT,
    etikett TEXT,
    fastighetsbeteckning TEXT,
    area_m2 DOUBLE PRECISION,
    geom geometry(MultiPolygon, 3006),
    grid_id INT NOT NULL,
    
    CONSTRAINT registerenhetsomradesytor_pkey PRIMARY KEY (id, grid_id),
    CONSTRAINT registerenhetsomradesytor_objekt_id_key UNIQUE (objekt_id, grid_id)
) PARTITION BY LIST (grid_id);

-- ── 3. CORE.LM_MARK ──────────────────────────────────────────────────────
RAISE NOTICE 'Migrating core.lm_mark...';

-- Vi antar att core.lm_mark existerar baserat på tidigare indexerings-scripts.
ALTER TABLE core.lm_mark RENAME TO lm_mark_legacy;

CREATE TABLE core.lm_mark (
    ogc_fid SERIAL,
    objekt_id TEXT,
    objekttyp TEXT,
    detaljtyp TEXT,
    geom geometry(MultiPolygon, 3006),
    grid_id INT NOT NULL,
    
    CONSTRAINT lm_mark_pkey PRIMARY KEY (ogc_fid, grid_id)
) PARTITION BY LIST (grid_id);

-- ── 4. CORE.LM_BYGGNAD ───────────────────────────────────────────────────
RAISE NOTICE 'Migrating core.lm_byggnad...';

ALTER TABLE core.lm_byggnad RENAME TO lm_byggnad_legacy;

CREATE TABLE core.lm_byggnad (
    ogc_fid SERIAL,
    objekt_id TEXT,
    objekttyp TEXT,
    detaljtyp TEXT,
    geom geometry(MultiPolygon, 3006),
    grid_id INT NOT NULL,
    
    CONSTRAINT lm_byggnad_pkey PRIMARY KEY (ogc_fid, grid_id)
) PARTITION BY LIST (grid_id);

-- ── 5. GENERERA PARTITIONER FÖR SVERIGE (200k-900k, 6100k-7700k) ──────────
DO $$
DECLARE
    gx INT;
    gy INT;
    gid INT;
    tname TEXT;
    target_tables TEXT[] := ARRAY['env.registerenhetsomradesytor', 'core.lm_mark', 'core.lm_byggnad'];
BEGIN
    FOR gx IN 2..9 LOOP
        FOR gy IN 61..77 LOOP
            gid := (gx * 100) + gy;
            
            FOREACH tname IN ARRAY target_tables LOOP
                EXECUTE format('CREATE TABLE IF NOT EXISTS %s_g%s PARTITION OF %s FOR VALUES IN (%s)', 
                    tname, gid, tname, gid);
            END LOOP;
        END LOOP;
    END LOOP;
    
    -- Default partitioner för data utanför griden
    FOREACH tname IN ARRAY target_tables LOOP
        EXECUTE format('CREATE TABLE IF NOT EXISTS %s_default PARTITION OF %s DEFAULT', tname, tname);
    END LOOP;
END $$;

-- ── 6. DATAÖVERFÖRING (DETTA ÄR DEN TUNGA BITEN) ─────────────────────────
RAISE NOTICE 'Copying data and calculating grid IDs. This will take significant time for 40M+ rows...';

-- Fastigheter
INSERT INTO env.registerenhetsomradesytor (
    objekt_id, externid, fastighet_id, objekt_version, detaljtyp, 
    kommunnamn, trakt, etikett, fastighetsbeteckning, area_m2, geom, grid_id
)
SELECT 
    objekt_id, externid, fastighet_id, objekt_version, detaljtyp, 
    kommunnamn, trakt, etikett, fastighetsbeteckning, area_m2, geom,
    public.get_spatial_grid_id(geom)
FROM env.registerenhetsomradesytor_legacy;

-- Mark
INSERT INTO core.lm_mark (objekt_id, objekttyp, detaljtyp, geom, grid_id)
SELECT objekt_id, objekttyp, detaljtyp, geom, public.get_spatial_grid_id(geom)
FROM core.lm_mark_legacy;

-- Byggnad
INSERT INTO core.lm_byggnad (objekt_id, objekttyp, detaljtyp, geom, grid_id)
SELECT objekt_id, objekttyp, detaljtyp, geom, public.get_spatial_grid_id(geom)
FROM core.lm_byggnad_legacy;

-- ── 7. ÅTERSKAPA INDEX PÅ DE NYA TABELLERNA ───────────────────────────────
RAISE NOTICE 'Creating spatial indexes on partitioned tables...';

-- GIST index på master-tabellerna sprids automatiskt till partitionerna
CREATE INDEX idx_regenhet_geom ON env.registerenhetsomradesytor USING GIST (geom);
CREATE INDEX idx_lm_mark_geom ON core.lm_mark USING GIST (geom);
CREATE INDEX idx_lm_byggnad_geom ON core.lm_byggnad USING GIST (geom);

-- B-tree index för vanliga sökningar
CREATE INDEX idx_regenhet_fastighet ON env.registerenhetsomradesytor (fastighetsbeteckning);
CREATE INDEX idx_regenhet_muni_lookup ON env.registerenhetsomradesytor (kommunnamn, trakt, etikett);

-- BRIN index på grid_id för extremt snabba grov-gallringar
CREATE INDEX idx_regenhet_brin_grid ON env.registerenhetsomradesytor USING BRIN (grid_id);
CREATE INDEX idx_lm_mark_brin_grid ON core.lm_mark USING BRIN (grid_id);

RAISE NOTICE 'Phase 2 Migration completed successfully.';

COMMIT;
