-- Reference seed for env.registerenhetsomradesytor (applied in tests/setup/database.ts globalSetup).
-- Kept in repo for Mimers Brunn offline-first documentation.

INSERT INTO env.registerenhetsomradesytor (etikett, kommunnamn, trakt, geom)
SELECT '1:1', 'GÄVLE', 'BRYNÄS',
  ST_Multi(ST_Transform(
    ST_SetSRID(ST_GeomFromText('POLYGON((17.13 60.66, 17.15 60.66, 17.15 60.68, 17.13 60.68, 17.13 60.66))'), 4326),
    3006
  ))
WHERE NOT EXISTS (
  SELECT 1 FROM env.registerenhetsomradesytor WHERE etikett = '1:1' AND trakt = 'BRYNÄS'
);
