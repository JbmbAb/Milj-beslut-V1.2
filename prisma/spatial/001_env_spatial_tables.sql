-- Versioned Spatial Schema: env
-- Purpose: Documentation and versioning of SGU and Environmental spatial layers.
-- These tables are managed outside of Prisma to support complex PostGIS types and indexes.

-- 1. Initialize Schema
CREATE SCHEMA IF NOT EXISTS env;

-- 2. SGU Ground Layers (Jordartskartor)
CREATE TABLE IF NOT EXISTS env.sgu_ground_layer (
  id int8 NOT NULL DEFAULT nextval('env.sgu_ground_layer_id_seq'::regclass),
  source_key text NOT NULL,
  source_object_id int8,
  layer_code int4,
  layer_label text,
  mapping_name text,
  map_type int4,
  symbol int4,
  area_sqm float8,
  length_m float8,
  source_dataset text NOT NULL DEFAULT 'SGU jordarter 1 miljon / grundlager'::text,
  source_scale text NOT NULL DEFAULT '1:1 000 000'::text,
  raw_properties jsonb NOT NULL DEFAULT '{}'::jsonb,
  imported_at timestamptz NOT NULL DEFAULT now(),
  geom geometry
);

CREATE UNIQUE INDEX IF NOT EXISTS sgu_ground_layer_pkey ON env.sgu_ground_layer USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS sgu_ground_layer_source_key_key ON env.sgu_ground_layer USING btree (source_key);
CREATE INDEX IF NOT EXISTS sgu_ground_layer_code_idx ON env.sgu_ground_layer USING btree (layer_code);
CREATE INDEX IF NOT EXISTS sgu_ground_layer_label_idx ON env.sgu_ground_layer USING btree (layer_label);
CREATE INDEX IF NOT EXISTS sgu_ground_layer_geom_gix ON env.sgu_ground_layer USING gist (geom);

-- 3. SGU Landslide Features (Jordskred & Raviner)
CREATE TABLE IF NOT EXISTS env.sgu_landslide_feature (
  id int8 NOT NULL DEFAULT nextval('env.sgu_landslide_feature_id_seq'::regclass),
  source_key text NOT NULL,
  source_object_id int8,
  feature_code int4,
  feature_label text,
  symbol int4,
  length_m float8,
  source_dataset text NOT NULL DEFAULT 'SGU jordskred-raviner'::text,
  raw_properties jsonb NOT NULL DEFAULT '{}'::jsonb,
  imported_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS sgu_landslide_feature_pkey ON env.sgu_landslide_feature USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS sgu_landslide_feature_source_key_key ON env.sgu_landslide_feature USING btree (source_key);
CREATE INDEX IF NOT EXISTS sgu_landslide_feature_code_idx ON env.sgu_landslide_feature USING btree (feature_code);
CREATE INDEX IF NOT EXISTS sgu_landslide_feature_label_idx ON env.sgu_landslide_feature USING btree (feature_label);

-- 4. Natura 2000 Areas
CREATE TABLE IF NOT EXISTS env.natura2000_area (
  id int8 NOT NULL DEFAULT nextval('env.natura2000_area_id_seq'::regclass),
  external_id text NOT NULL,
  site_name text,
  site_code text,
  category text,
  geom geometry
);

CREATE UNIQUE INDEX IF NOT EXISTS natura2000_area_pkey ON env.natura2000_area USING btree (external_id);
CREATE INDEX IF NOT EXISTS natura2000_area_geom_gix ON env.natura2000_area USING gist (geom);

-- 5. Protected Areas (Skyddad Natur)
CREATE TABLE IF NOT EXISTS env.protected_area (
  id int8 NOT NULL DEFAULT nextval('env.protected_area_id_seq'::regclass),
  nvr_id text NOT NULL,
  decision_status text NOT NULL,
  name text,
  protection_type text,
  decision_authority text,
  valid_from date,
  valid_to date,
  area_ha numeric,
  geom geometry
);

CREATE UNIQUE INDEX IF NOT EXISTS protected_area_pkey ON env.protected_area USING btree (nvr_id, decision_status);
CREATE INDEX IF NOT EXISTS protected_area_geom_gix ON env.protected_area USING gist (geom);
