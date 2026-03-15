-- Merge reviewed SGU staging data into canonical env tables.
-- Run manually after staged import has been checked.

INSERT INTO env.sgu_ground_layer (
  source_key,
  source_object_id,
  layer_code,
  layer_label,
  mapping_name,
  map_type,
  symbol,
  area_sqm,
  length_m,
  raw_properties,
  geom,
  imported_at
)
SELECT
  s.source_key,
  s.source_object_id,
  s.layer_code,
  s.layer_label,
  s.mapping_name,
  s.map_type,
  s.symbol,
  s.area_sqm,
  s.length_m,
  s.raw_properties,
  ST_Multi(
    ST_CollectionExtract(
      ST_MakeValid(s.geom),
      3
    )
  )::geometry(MultiPolygon, 3006),
  now()
FROM stage.sgu_ground_layer_raw s
WHERE s.geom IS NOT NULL
ON CONFLICT (source_key) DO UPDATE
SET
  source_object_id = EXCLUDED.source_object_id,
  layer_code = EXCLUDED.layer_code,
  layer_label = EXCLUDED.layer_label,
  mapping_name = EXCLUDED.mapping_name,
  map_type = EXCLUDED.map_type,
  symbol = EXCLUDED.symbol,
  area_sqm = EXCLUDED.area_sqm,
  length_m = EXCLUDED.length_m,
  raw_properties = EXCLUDED.raw_properties,
  geom = EXCLUDED.geom,
  imported_at = now();

INSERT INTO env.sgu_landslide_feature (
  source_key,
  source_object_id,
  feature_code,
  feature_label,
  symbol,
  length_m,
  raw_properties,
  geom,
  imported_at
)
SELECT
  s.source_key,
  s.source_object_id,
  s.feature_code,
  s.feature_label,
  s.symbol,
  s.length_m,
  s.raw_properties,
  ST_Multi(
    ST_CollectionExtract(
      ST_MakeValid(s.geom),
      2
    )
  )::geometry(MultiLineString, 3006),
  now()
FROM stage.sgu_landslide_feature_raw s
WHERE s.geom IS NOT NULL
ON CONFLICT (source_key) DO UPDATE
SET
  source_object_id = EXCLUDED.source_object_id,
  feature_code = EXCLUDED.feature_code,
  feature_label = EXCLUDED.feature_label,
  symbol = EXCLUDED.symbol,
  length_m = EXCLUDED.length_m,
  raw_properties = EXCLUDED.raw_properties,
  geom = EXCLUDED.geom,
  imported_at = now();

ANALYZE stage.sgu_ground_layer_raw;
ANALYZE env.sgu_ground_layer;
ANALYZE stage.sgu_landslide_feature_raw;
ANALYZE env.sgu_landslide_feature;
