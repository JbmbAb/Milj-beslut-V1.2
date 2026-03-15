-- Merge reviewed property unit data from staging into canonical core table.
-- Run manually after staging import has been checked.

INSERT INTO core.property_unit (
  source_key,
  designation,
  municipality_code,
  municipality_name,
  county_code,
  raw_properties,
  geom,
  source_updated_at
)
SELECT
  s.source_key,
  s.designation,
  s.municipality_code,
  s.municipality_name,
  s.county_code,
  s.raw_properties,
  ST_Multi(
    ST_CollectionExtract(
      ST_MakeValid(s.geom),
      3
    )
  )::geometry(MultiPolygon, 3006),
  now()
FROM stage.property_unit_raw s
WHERE s.designation IS NOT NULL
  AND s.geom IS NOT NULL
ON CONFLICT (source_key) DO UPDATE
SET
  designation = EXCLUDED.designation,
  municipality_code = EXCLUDED.municipality_code,
  municipality_name = EXCLUDED.municipality_name,
  county_code = EXCLUDED.county_code,
  raw_properties = EXCLUDED.raw_properties,
  geom = EXCLUDED.geom,
  source_updated_at = now();

ANALYZE stage.property_unit_raw;
ANALYZE core.property_unit;
