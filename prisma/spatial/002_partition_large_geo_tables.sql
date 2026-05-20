-- Filename: 002_partition_large_geo_tables.sql
-- Purpose:  Konfigurerar deklarativ partitionering för mycket stora geodatatabeller (500M+ rader).
--           Använder spatial grid-partitionering (100km rutor) för maximal prestanda vid massiv import.

DO $$
DECLARE
    grid_x INT;
    grid_y INT;
    grid_id INT;
BEGIN

-- PARTITION env.sgu_ground_layer
-- Denna tabell populeras av import-sgu-risk-layers.ts via COPY-kommando.

-- 1. Ta bort den gamla tabellen om den finns och INTE är partitionerad.
IF EXISTS (
    SELECT 1 FROM pg_tables 
    WHERE schemaname = 'env' AND tablename = 'sgu_ground_layer'
) AND NOT EXISTS (
    SELECT 1 FROM pg_partitioned_table 
    WHERE partrelid = 'env.sgu_ground_layer'::regclass
) THEN
    DROP TABLE env.sgu_ground_layer CASCADE;
END IF;

-- 2. Skapa den partitionerade master-tabellen.
-- Partitionsnyckeln är `grid_id` (baserat på 100km spatial grid).
-- Primary Key MÅSTE inkludera partitionsnyckeln.
CREATE TABLE IF NOT EXISTS env.sgu_ground_layer (
    source_key          TEXT NOT NULL,
    source_object_id    INTEGER,
    layer_code          INTEGER,
    layer_label         TEXT,
    mapping_name        TEXT,
    map_type            INTEGER,
    symbol              INTEGER,
    area_sqm            NUMERIC,
    length_m            NUMERIC,
    raw_properties      JSONB,
    imported_at         TIMESTAMPTZ DEFAULT now(),
    geom                GEOMETRY(MultiPolygon, 3006),
    grid_id             INT NOT NULL, -- Beräknas som (floor(X/100000)*100 + floor(Y/100000))
    PRIMARY KEY (source_key, grid_id)
) PARTITION BY LIST (grid_id);

RAISE NOTICE 'Master table env.sgu_ground_layer created or already exists.';

-- 3. Skapa partitioner för det svenska koordinatsystemet (SWEREF99 TM).
-- Sverige täcker grovt X: 200k-900k och Y: 6100k-7700k.
FOR grid_x IN 2..9 LOOP
    FOR grid_y IN 61..77 LOOP
        grid_id := (grid_x * 100) + grid_y;
        
        EXECUTE format(
            'CREATE TABLE IF NOT EXISTS env.sgu_ground_layer_g%s PARTITION OF env.sgu_ground_layer FOR VALUES IN (%s)',
            grid_id, grid_id
        );
        
        -- OBS: Vi skapar INGA index här. De skapas i batch efter att 100M+ rader laddats in 
        -- för att undvika "index thrashing" under bulk-import.
    END LOOP;
END LOOP;

-- 4. Skapa en default-partition för data som hamnar utanför griden.
CREATE TABLE IF NOT EXISTS env.sgu_ground_layer_default PARTITION OF env.sgu_ground_layer DEFAULT;

RAISE NOTICE 'Grid partitions for env.sgu_ground_layer created.';

END $$;
