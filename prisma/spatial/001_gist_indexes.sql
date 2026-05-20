-- GIST Indexes for Spatial Tables

CREATE INDEX IF NOT EXISTS protected_area_geom_gist ON env.protected_area USING GIST (geom);
CREATE INDEX IF NOT EXISTS natura2000_area_geom_gist ON env.natura2000_area USING GIST (geom);
CREATE INDEX IF NOT EXISTS lm_byggnad_geom_gist ON core.lm_byggnad USING GIST (geom);
CREATE INDEX IF NOT EXISTS sgu_soil_type_geom_gist ON env.sgu_soil_type USING GIST (geom);
CREATE INDEX IF NOT EXISTS sgu_soil_type_25k_100k_geom_gist ON env.sgu_soil_type_25k_100k USING GIST (geom);
CREATE INDEX IF NOT EXISTS sgu_blockighet_geom_gist ON env.sgu_blockighet USING GIST (geom);
CREATE INDEX IF NOT EXISTS sgu_landslide_feature_geom_gist ON env.sgu_landslide_feature USING GIST (geom);
CREATE INDEX IF NOT EXISTS sgu_punktobjekt_geom_gist ON env.sgu_punktobjekt USING GIST (geom);
CREATE INDEX IF NOT EXISTS sgu_well_geom_gist ON env.sgu_well USING GIST (geom);
CREATE INDEX IF NOT EXISTS lm_mark_geom_gist ON core.lm_mark USING GIST (geom);
CREATE INDEX IF NOT EXISTS water_protection_area_geom_gist ON env.water_protection_area USING GIST (geom);
