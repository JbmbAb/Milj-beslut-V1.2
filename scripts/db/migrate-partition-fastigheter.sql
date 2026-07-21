-- Surgical migration for env.registerenhetsomradesytor to spatial partitioning
-- Optimized for 30M-50M row scale

BEGIN;

-- 1. Ensure grid function exists
CREATE OR REPLACE FUNCTION public.get_spatial_grid_id(geom geometry)
RETURNS int AS $$
BEGIN
    RETURN (floor(ST_X(ST_Centroid(geom))/100000)*100 + floor(ST_Y(ST_Centroid(geom))/100000))::int;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- 2. Rename existing table and its primary key
ALTER TABLE env.registerenhetsomradesytor RENAME TO registerenhetsomradesytor_legacy;
ALTER TABLE env.registerenhetsomradesytor_legacy RENAME CONSTRAINT registerenhetsomradesytor_pkey TO registerenhetsomradesytor_legacy_pkey;

-- 3. Create partitioned table
-- Note: we use the column names from the ACTUAL table I found earlier
CREATE TABLE env.registerenhetsomradesytor (
    fid SERIAL,
    objektidentitet character varying,
    registerenhetsreferens character varying,
    objekttyp character varying,
    senastandrad timestamp with time zone,
    lanskod character varying,
    kommunkod character varying,
    kommunnamn character varying,
    trakt character varying,
    block character varying,
    enhet bigint,
    omradesnummer smallint,
    samjelittera character varying,
    osakertlage boolean,
    etikett character varying,
    geom geometry(MultiPolygon, 3006),
    grid_id INT NOT NULL,
    
    CONSTRAINT registerenhetsomradesytor_pkey PRIMARY KEY (fid, grid_id)
) PARTITION BY LIST (grid_id);

-- 4. Generate partitions for Sweden (100km grid)
DO $$
DECLARE
    gx INT;
    gy INT;
    gid INT;
BEGIN
    FOR gx IN 2..9 LOOP
        FOR gy IN 61..77 LOOP
            gid := (gx * 100) + gy;
            EXECUTE format('CREATE TABLE IF NOT EXISTS env.registerenhetsomradesytor_g%s PARTITION OF env.registerenhetsomradesytor FOR VALUES IN (%s)', gid, gid);
        END LOOP;
    END LOOP;
    
    CREATE TABLE IF NOT EXISTS env.registerenhetsomradesytor_default PARTITION OF env.registerenhetsomradesytor DEFAULT;
END $$;

-- 5. Copy data (This might take a while for 4.3M rows, but 4.3M is fast enough for one transaction)
-- We transform the geometry to 3006 just in case (I saw it was SRID 1 earlier)
INSERT INTO env.registerenhetsomradesytor (
    objektidentitet, registerenhetsreferens, objekttyp, senastandrad,
    lanskod, kommunkod, kommunnamn, trakt, block, enhet,
    omradesnummer, samjelittera, osakertlage, etikett, geom, grid_id
)
SELECT 
    objektidentitet, registerenhetsreferens, objekttyp, senastandrad,
    lanskod, kommunkod, kommunnamn, trakt, block, enhet,
    omradesnummer, samjelittera, osakertlage, etikett, ST_SetSRID(geom, 3006),
    public.get_spatial_grid_id(ST_SetSRID(geom, 3006))
FROM env.registerenhetsomradesytor_legacy;

-- 6. Create indexes
CREATE INDEX idx_regenhet_geom ON env.registerenhetsomradesytor USING GIST (geom);
CREATE INDEX idx_regenhet_objektid ON env.registerenhetsomradesytor (objektidentitet);
CREATE INDEX idx_regenhet_trakt ON env.registerenhetsomradesytor (trakt);
CREATE INDEX idx_regenhet_brin_grid ON env.registerenhetsomradesytor USING BRIN (grid_id);

COMMIT;

-- 7. Cleanup (Optional, but safe to keep for a while)
-- DROP TABLE env.registerenhetsomradesytor_legacy;
