-- GIST indexes for spatial tables (only when table + geometry column exist).

DO $$
DECLARE
  rec RECORD;
BEGIN
  FOR rec IN
    SELECT *
    FROM (
      VALUES
        ('env', 'protected_area', 'geom', 'protected_area_geom_gist'),
        ('env', 'natura2000_area', 'wkb_geometry', 'natura2000_area_geom_gist'),
        ('core', 'lm_byggnad', 'geom', 'lm_byggnad_geom_gist'),
        ('topo10', 'byggnad', 'geom', 'topo10_byggnad_geom_gist'),
        ('env', 'sgu_soil_type', 'geom', 'sgu_soil_type_geom_gist'),
        ('env', 'sgu_soil_type_25k_100k', 'geom', 'sgu_soil_type_25k_100k_geom_gist'),
        ('env', 'sgu_blockighet', 'geom', 'sgu_blockighet_geom_gist'),
        ('env', 'sgu_landslide_feature', 'geom', 'sgu_landslide_feature_geom_gist'),
        ('env', 'sgu_punktobjekt', 'geom', 'sgu_punktobjekt_geom_gist'),
        ('env', 'sgu_well', 'geom', 'sgu_well_geom_gist'),
        ('env', 'sgu_well_actual', 'geom', 'sgu_well_actual_geom_gist'),
        ('core', 'lm_mark', 'geom', 'lm_mark_geom_gist'),
        ('env', 'marktacke', 'geom', 'marktacke_geom_gist'),
        ('env', 'registerenhetsomradesytor', 'geom', 'registerenhetsomradesytor_geom_gist'),
        ('env', 'registerenhetsomradeslinjer', 'geom', 'registerenhetsomradeslinjer_geom_gist'),
        ('env', 'water_protection_area', 'wkb_geometry', 'water_protection_area_geom_gist')
    ) AS targets(schema_name, table_name, geom_col, index_name)
  LOOP
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns c
      WHERE c.table_schema = rec.schema_name
        AND c.table_name = rec.table_name
        AND c.column_name = rec.geom_col
    ) THEN
      EXECUTE format(
        'CREATE INDEX IF NOT EXISTS %I ON %I.%I USING GIST (%I)',
        rec.index_name,
        rec.schema_name,
        rec.table_name,
        rec.geom_col
      );
      RAISE NOTICE 'GiST index % on %.%(%)', rec.index_name, rec.schema_name, rec.table_name, rec.geom_col;
    END IF;
  END LOOP;
END $$;
