-- SGU layer pipeline for coarse ground layer context and landslide/ravine features.
-- Run manually after scripts/enable_postgis.sql.

CREATE SCHEMA IF NOT EXISTS stage;
CREATE SCHEMA IF NOT EXISTS env;

CREATE TABLE IF NOT EXISTS stage.sgu_ground_layer_raw (
  source_key text PRIMARY KEY,
  source_object_id bigint,
  layer_code integer,
  layer_label text,
  mapping_name text,
  map_type integer,
  symbol integer,
  area_sqm double precision,
  length_m double precision,
  raw_properties jsonb NOT NULL DEFAULT '{}'::jsonb,
  geom geometry(MultiPolygon, 3006) NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE stage.sgu_ground_layer_raw
IS 'Staging table for SGU jordarter 1 miljon / grundlager before reviewed merge to env.sgu_ground_layer.';

CREATE TABLE IF NOT EXISTS env.sgu_ground_layer (
  id bigserial PRIMARY KEY,
  source_key text NOT NULL UNIQUE,
  source_object_id bigint,
  layer_code integer,
  layer_label text,
  mapping_name text,
  map_type integer,
  symbol integer,
  area_sqm double precision,
  length_m double precision,
  source_dataset text NOT NULL DEFAULT 'SGU jordarter 1 miljon / grundlager',
  source_scale text NOT NULL DEFAULT '1:1 000 000',
  raw_properties jsonb NOT NULL DEFAULT '{}'::jsonb,
  geom geometry(MultiPolygon, 3006) NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE env.sgu_ground_layer
IS 'Canonical SGU coarse ground layer context. Screening only, not parcel-precise legal basis.';

CREATE INDEX IF NOT EXISTS sgu_ground_layer_geom_gix
  ON env.sgu_ground_layer
  USING GIST (geom);

CREATE INDEX IF NOT EXISTS sgu_ground_layer_code_idx
  ON env.sgu_ground_layer (layer_code);

CREATE INDEX IF NOT EXISTS sgu_ground_layer_label_idx
  ON env.sgu_ground_layer (layer_label);

CREATE TABLE IF NOT EXISTS stage.sgu_landslide_feature_raw (
  source_key text PRIMARY KEY,
  source_object_id bigint,
  feature_code integer,
  feature_label text,
  symbol integer,
  length_m double precision,
  raw_properties jsonb NOT NULL DEFAULT '{}'::jsonb,
  geom geometry(MultiLineString, 3006) NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE stage.sgu_landslide_feature_raw
IS 'Staging table for SGU jordskred-raviner before reviewed merge to env.sgu_landslide_feature.';

CREATE TABLE IF NOT EXISTS env.sgu_landslide_feature (
  id bigserial PRIMARY KEY,
  source_key text NOT NULL UNIQUE,
  source_object_id bigint,
  feature_code integer,
  feature_label text,
  symbol integer,
  length_m double precision,
  source_dataset text NOT NULL DEFAULT 'SGU jordskred-raviner',
  raw_properties jsonb NOT NULL DEFAULT '{}'::jsonb,
  geom geometry(MultiLineString, 3006) NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE env.sgu_landslide_feature
IS 'Canonical SGU ravine/landslide features. Decision support only and always requires human review.';

CREATE INDEX IF NOT EXISTS sgu_landslide_feature_geom_gix
  ON env.sgu_landslide_feature
  USING GIST (geom);

CREATE INDEX IF NOT EXISTS sgu_landslide_feature_code_idx
  ON env.sgu_landslide_feature (feature_code);

CREATE INDEX IF NOT EXISTS sgu_landslide_feature_label_idx
  ON env.sgu_landslide_feature (feature_label);
