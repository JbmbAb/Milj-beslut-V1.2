import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import pkg from 'pg';
const { Client } = pkg;

const envTestPath = path.resolve(process.cwd(), '.env.test');
if (fs.existsSync(envTestPath)) {
  dotenv.config({ path: envTestPath, override: false });
}
dotenv.config();

export async function applyGisTestStubs(): Promise<void> {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: false,
  });
  await client.connect();
  try {
    await client.query('DROP EXTENSION IF EXISTS postgis_raster CASCADE');
    await client.query('DROP EXTENSION IF EXISTS postgis CASCADE');
    await client.query('CREATE EXTENSION postgis');
    await client.query('CREATE EXTENSION postgis_raster');
    await client.query('CREATE EXTENSION IF NOT EXISTS "unaccent";');
    await client.query('CREATE EXTENSION IF NOT EXISTS "pg_trgm";');
    await client.query('CREATE SCHEMA IF NOT EXISTS "env";');
    await client.query('CREATE SCHEMA IF NOT EXISTS "core";');
    await client.query('CREATE SCHEMA IF NOT EXISTS "topo10";');

    await client.query(`
      DROP TABLE IF EXISTS env.registerenhetsomradesytor CASCADE;
      DROP TABLE IF EXISTS env.registerenhetsomradeslinjer CASCADE;
      DROP TABLE IF EXISTS env.protected_area CASCADE;
      DROP TABLE IF EXISTS env.natura2000_area CASCADE;
      DROP TABLE IF EXISTS core.lm_byggnad CASCADE;
      DROP TABLE IF EXISTS env.sgu_soil_type CASCADE;
      DROP TABLE IF EXISTS env.sgu_soil_type_25k_100k CASCADE;
      DROP TABLE IF EXISTS env.sgu_blockighet CASCADE;
      DROP TABLE IF EXISTS env.sgu_landslide_feature CASCADE;
      DROP TABLE IF EXISTS env.sgu_punktobjekt CASCADE;
      DROP TABLE IF EXISTS env.sgu_well CASCADE;
      DROP TABLE IF EXISTS env.sgu_borrhal CASCADE;
      DROP TABLE IF EXISTS env.ebh_potentiellt_fororenade_omraden CASCADE;
      DROP TABLE IF EXISTS core.lm_mark CASCADE;
      DROP TABLE IF EXISTS env.marktacke CASCADE;
      DROP TABLE IF EXISTS topo10.byggnad CASCADE;
      DROP TABLE IF EXISTS topo10.mark CASCADE;
      DROP TABLE IF EXISTS topo10.vatten CASCADE;
      DROP TABLE IF EXISTS topo10.vag CASCADE;
      DROP TABLE IF EXISTS topo10.jarnvag CASCADE;
      DROP TABLE IF EXISTS core.property_unit CASCADE;
      DROP TABLE IF EXISTS env.water_protection_area CASCADE;
    `);

    await client.query(`
      CREATE OR REPLACE FUNCTION core.normalize_designation(input_text text)
      RETURNS text AS $$
      BEGIN
          -- Convert to uppercase, unaccent, and replace non-alphanumeric with spaces
          RETURN trim(regexp_replace(upper(unaccent(input_text)), '[^A-Z0-9]', ' ', 'g'));
      END;
      $$ LANGUAGE plpgsql IMMUTABLE;

      CREATE TABLE IF NOT EXISTS "env"."protected_area" (
          nvr_id TEXT PRIMARY KEY,
          name TEXT,
          protection_type TEXT,
          decision_status TEXT,
          wkb_geometry geometry(MultiPolygon, 3006),
          geom geometry(MultiPolygon, 3006)
      );

      CREATE TABLE IF NOT EXISTS "env"."natura2000_area" (
          external_id TEXT PRIMARY KEY,
          site_name TEXT,
          category TEXT,
          wkb_geometry geometry(MultiPolygon, 3006),
          geom geometry(MultiPolygon, 3006)
      );

      CREATE TABLE IF NOT EXISTS "core"."lm_byggnad" (
          id SERIAL PRIMARY KEY,
          geom geometry(MultiPolygon, 3006)
      );

      CREATE TABLE IF NOT EXISTS "env"."sgu_soil_type" (
          id SERIAL PRIMARY KEY,
          jordart TEXT,
          geom geometry(MultiPolygon, 3006)
      );

      CREATE TABLE IF NOT EXISTS "env"."sgu_soil_type_25k_100k" (
          id SERIAL PRIMARY KEY,
          jordart TEXT,
          jy1 INTEGER,
          jy1_tx TEXT,
          karttyp INTEGER,
          jg2 TEXT,
          jg2_tx TEXT,
          geom geometry(MultiPolygon, 3006)
      );

      CREATE TABLE IF NOT EXISTS "env"."sgu_blockighet" (
          id SERIAL PRIMARY KEY,
          geom geometry(MultiPolygon, 3006)
      );

      CREATE TABLE IF NOT EXISTS "env"."sgu_landslide_feature" (
          id SERIAL PRIMARY KEY,
          source_key TEXT,
          feature_code TEXT,
          feature_label TEXT,
          sl INTEGER,
          sl_tx TEXT,
          symbol INTEGER,
          geom geometry(MultiPolygon, 3006)
      );

      CREATE TABLE IF NOT EXISTS "env"."sgu_punktobjekt" (
          id SERIAL PRIMARY KEY,
          geom geometry(Point, 3006)
      );

      CREATE TABLE IF NOT EXISTS "env"."sgu_well" (
          id SERIAL PRIMARY KEY,
          geom geometry(Point, 3006)
      );

      CREATE TABLE IF NOT EXISTS "env"."sgu_borrhal" (
          id SERIAL PRIMARY KEY,
          depth_from NUMERIC,
          tot_depth NUMERIC,
          geom geometry(Point, 3006)
      );

      CREATE TABLE IF NOT EXISTS "env"."ebh_potentiellt_fororenade_omraden" (
          id SERIAL PRIMARY KEY,
          geom geometry(MultiPolygon, 3006)
      );

      CREATE TABLE IF NOT EXISTS "core"."lm_mark" (
          id SERIAL PRIMARY KEY,
          geom geometry(MultiPolygon, 3006)
      );

      CREATE TABLE IF NOT EXISTS "env"."marktacke" (
          id SERIAL PRIMARY KEY,
          detaljtyp TEXT,
          klass_kod INTEGER,
          rast raster,
          geom geometry(MultiPolygon, 3006)
      );

      CREATE TABLE IF NOT EXISTS "topo10"."byggnad" (
          id SERIAL PRIMARY KEY,
          objektidentitet TEXT,
          objekttyp TEXT,
          geom geometry(MultiPolygon, 3006)
      );

      CREATE TABLE IF NOT EXISTS "topo10"."mark" (
          id SERIAL PRIMARY KEY,
          objektidentitet TEXT,
          objekttyp TEXT,
          geom geometry(MultiPolygon, 3006)
      );

      CREATE TABLE IF NOT EXISTS "topo10"."vatten" (
          id SERIAL PRIMARY KEY,
          objektidentitet TEXT,
          objekttyp TEXT,
          geom geometry(MultiPolygon, 3006)
      );

      CREATE TABLE IF NOT EXISTS "topo10"."vag" (
          id SERIAL PRIMARY KEY,
          objektidentitet TEXT,
          objekttyp TEXT,
          geom geometry(MultiLineString, 3006)
      );

      CREATE TABLE IF NOT EXISTS "topo10"."jarnvag" (
          id SERIAL PRIMARY KEY,
          objektidentitet TEXT,
          objekttyp TEXT,
          geom geometry(MultiLineString, 3006)
      );

      CREATE TABLE IF NOT EXISTS "core"."property_unit" (
          id SERIAL PRIMARY KEY,
          source_key TEXT UNIQUE,
          designation TEXT,
          designation_norm TEXT,
          municipality_code TEXT,
          municipality_name TEXT,
          county_code TEXT,
          source_dataset TEXT,
          source_updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          raw_properties JSONB,
          geom geometry(MultiPolygon, 3006)
      );

      CREATE INDEX IF NOT EXISTS property_unit_designation_norm_idx ON core.property_unit(designation_norm);
      CREATE INDEX IF NOT EXISTS property_unit_designation_norm_trgm_idx ON core.property_unit USING gin (designation_norm gin_trgm_ops);

      CREATE OR REPLACE FUNCTION core.trg_property_unit_normalize()
      RETURNS TRIGGER AS $$
      BEGIN
          NEW.designation_norm := core.normalize_designation(NEW.designation);
          RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;

      DROP TRIGGER IF EXISTS property_unit_normalize_trg ON core.property_unit;
      CREATE TRIGGER property_unit_normalize_trg
      BEFORE INSERT OR UPDATE OF designation ON core.property_unit
      FOR EACH ROW EXECUTE FUNCTION core.trg_property_unit_normalize();

      CREATE TABLE IF NOT EXISTS "env"."water_protection_area" (
          id SERIAL PRIMARY KEY,
          name TEXT,
          namn TEXT,
          nvr_id TEXT,
          nvrid TEXT,
          tillsynsmh TEXT,
          sengalldat DATE,
          ursbesldat DATE,
          ogc_fid INTEGER,
          geom geometry(MultiPolygon, 3006)
      );

      CREATE SCHEMA IF NOT EXISTS climate;
      CREATE SCHEMA IF NOT EXISTS lm_staging;
      CREATE SCHEMA IF NOT EXISTS hydro;

      CREATE TABLE env.registerenhetsomradesytor (
          id SERIAL PRIMARY KEY,
          etikett TEXT,
          kommunnamn TEXT,
          trakt TEXT,
          geom geometry(MultiPolygon, 3006)
      );
      CREATE INDEX IF NOT EXISTS idx_registerenhetsomradesytor_geom
          ON env.registerenhetsomradesytor USING GIST (geom);

      CREATE TABLE IF NOT EXISTS env.registerenhetsomradeslinjer (
          id SERIAL PRIMARY KEY,
          geom geometry(MultiLineString, 3006)
      );

      CREATE TABLE IF NOT EXISTS env.sgu_jorddjupsmodell_10m (
          id SERIAL PRIMARY KEY,
          geom geometry(Geometry, 3006)
      );

      CREATE TABLE IF NOT EXISTS env.sgu_fastmark_stabilitet (
          id SERIAL PRIMARY KEY,
          geom geometry(Geometry, 3006)
      );

      CREATE TABLE IF NOT EXISTS env.env_sgu_grundvatten_sarbarhet (
          id SERIAL PRIMARY KEY,
          geom geometry(Geometry, 3006)
      );

      CREATE TABLE IF NOT EXISTS env.sgu_aktsamhet_efterarbetad (
          id SERIAL PRIMARY KEY,
          geom geometry(Geometry, 3006)
      );

      CREATE TABLE IF NOT EXISTS env.svaro_2016 (
          id SERIAL PRIMARY KEY,
          geom geometry(Geometry, 3006)
      );

      CREATE TABLE IF NOT EXISTS env.viss_sw_varo_risk (
          id SERIAL PRIMARY KEY,
          geom geometry(Geometry, 3006)
      );

      CREATE TABLE IF NOT EXISTS env.msb_pfra_pastevent (
          id SERIAL PRIMARY KEY,
          geom geometry(Geometry, 3006)
      );

      CREATE TABLE IF NOT EXISTS climate.flood_risk_area (
          id SERIAL PRIMARY KEY,
          geom geometry(Geometry, 3006)
      );

      ALTER TABLE env.protected_area ADD COLUMN IF NOT EXISTS geom geometry(MultiPolygon, 3006);
      ALTER TABLE env.natura2000_area ADD COLUMN IF NOT EXISTS geom geometry(MultiPolygon, 3006);

      CREATE TABLE IF NOT EXISTS "public"."PostgisImportBatch" (
          id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
          harvest_batch_id TEXT,
          target_schema TEXT NOT NULL,
          target_table TEXT NOT NULL,
          imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          row_count INTEGER,
          dataset_version TEXT,
          status TEXT NOT NULL DEFAULT 'PLANNED',
          manifest_path TEXT,
          content_bundle_sha256 TEXT NOT NULL DEFAULT '',
          source_runtime_path TEXT,
          ogr2ogr_version TEXT,
          started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          completed_at TIMESTAMPTZ,
          error_message TEXT,
          import_mode TEXT NOT NULL DEFAULT 'plan'
      );

      -- Deterministic Mimers Brunn mini-seed (offline test fixtures)
      DELETE FROM env.registerenhetsomradesytor;
      INSERT INTO env.registerenhetsomradesytor (etikett, kommunnamn, trakt, geom)
      VALUES (
          '1:1',
          'GÄVLE',
          'BRYNÄS',
          ST_Multi(ST_Transform(
              ST_SetSRID(ST_GeomFromText('POLYGON((17.13 60.66, 17.15 60.66, 17.15 60.68, 17.13 60.68, 17.13 60.66))'), 4326),
              3006
          ))
      );

      DELETE FROM env.sgu_soil_type_25k_100k;
      INSERT INTO env.sgu_soil_type_25k_100k (jordart, jg2_tx, geom)
      VALUES (
          'Morän',
          'Medel permeabilitet',
          ST_Multi(ST_Transform(
              ST_SetSRID(ST_GeomFromText('POLYGON((17.13 60.66, 17.15 60.66, 17.15 60.68, 17.13 60.68, 17.13 60.66))'), 4326),
              3006
          ))
      );

      DELETE FROM env.protected_area;
      INSERT INTO env.protected_area (nvr_id, name, protection_type, geom)
      VALUES (
          'TEST-NVR-1',
          'Test vattenskydd',
          'Vattenskyddsområde',
          ST_Multi(ST_Transform(
              ST_SetSRID(ST_GeomFromText('POLYGON((17.13 60.66, 17.15 60.66, 17.15 60.68, 17.13 60.68, 17.13 60.66))'), 4326),
              3006
          ))
      );

      DELETE FROM env.sgu_well;
      INSERT INTO env.sgu_well (geom)
      VALUES (
          ST_Transform(ST_SetSRID(ST_MakePoint(17.14, 60.67), 4326), 3006)
      );

      CREATE TABLE IF NOT EXISTS "public"."spatial_migrations" (
          id SERIAL PRIMARY KEY,
          "fileName" VARCHAR(255) NOT NULL,
          "appliedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          "durationMs" INTEGER
          );

      ALTER TABLE env.sgu_soil_type_25k_100k ADD COLUMN IF NOT EXISTS jy1 INTEGER;
      ALTER TABLE env.sgu_soil_type_25k_100k ADD COLUMN IF NOT EXISTS jy1_tx TEXT;
      ALTER TABLE env.sgu_soil_type_25k_100k ADD COLUMN IF NOT EXISTS karttyp INTEGER;

      ALTER TABLE env.sgu_landslide_feature ADD COLUMN IF NOT EXISTS sl INTEGER;
      ALTER TABLE env.sgu_landslide_feature ADD COLUMN IF NOT EXISTS sl_tx TEXT;

      CREATE OR REPLACE FUNCTION public.get_ml_features(
          property_id TEXT DEFAULT NULL,
          geometry geometry(geometry, 3006) DEFAULT NULL,
          buffer_distance DOUBLE PRECISION DEFAULT 0.0,
          feature_version INTEGER DEFAULT 1
      )
      RETURNS JSONB AS $$
      DECLARE
          active_geom geometry(geometry, 3006);
          prop_designation TEXT := NULL;
          found_flag BOOLEAN := false;
          result JSONB;
      BEGIN
          -- 1. Determine base geometry
          IF geometry IS NOT NULL THEN
              active_geom := ST_Transform(geometry, 3006);
              found_flag := true;
          ELSIF property_id IS NOT NULL AND property_id <> '' THEN
              SELECT geom, designation INTO active_geom, prop_designation
              FROM core.property_unit
              WHERE source_key = property_id
                 OR designation_norm = core.normalize_designation(property_id)
                 OR designation = property_id
              LIMIT 1;
              
              IF active_geom IS NOT NULL THEN
                  found_flag := true;
              END IF;
          END IF;

          -- If no geometry resolved, return standard negative response
          IF active_geom IS NULL THEN
              RETURN jsonb_build_object(
                  'found', false,
                  'property_id', property_id,
                  'feature_version', feature_version
              );
          END IF;

          -- 2. Apply buffer distance if requested (> 0)
          IF buffer_distance > 0.0 THEN
              active_geom := ST_Buffer(active_geom, buffer_distance);
          END IF;

          -- 3. Query spatial intersections and distances
          WITH soils AS (
              SELECT 
                  s.jy1 AS layer_code,
                  s.jy1_tx AS layer_label,
                  s.karttyp AS map_type,
                  CASE 
                    WHEN ST_Area(active_geom) = 0 THEN 0.0
                    ELSE ST_Area(ST_Intersection(s.geom, active_geom)) / ST_Area(active_geom)
                  END AS overlap_ratio
              FROM env.sgu_soil_type_25k_100k s
              WHERE ST_Intersects(s.geom, active_geom)
          ),
          landslides AS (
              SELECT 
                  l.id::text AS source_key,
                  l.sl AS feature_code,
                  l.sl_tx AS feature_label,
                  ST_Distance(l.geom, active_geom) AS distance_meters
              FROM env.sgu_landslide_feature l
              WHERE ST_DWithin(l.geom, active_geom, 500)
              ORDER BY distance_meters ASC
              LIMIT 5
          ),
          contaminated AS (
              SELECT 
                  e.id::text AS object_id,
                  ST_Distance(e.geom, active_geom) AS distance_meters
              FROM env.ebh_potentiellt_fororenade_omraden e
              WHERE ST_DWithin(e.geom, active_geom, 250)
              ORDER BY distance_meters ASC
              LIMIT 5
          ),
          protected AS (
              SELECT 
                  p.nvr_id,
                  p.name,
                  p.protection_type,
                  ST_Distance(p.geom, active_geom) AS distance_meters
              FROM env.protected_area p
              WHERE ST_DWithin(p.geom, active_geom, 250)
          )
          SELECT jsonb_build_object(
              'found', found_flag,
              'property_id', property_id,
              'property_designation', prop_designation,
              'buffer_distance', buffer_distance,
              'feature_version', feature_version,
              'soils', COALESCE((SELECT jsonb_agg(jsonb_build_object('layer_code', layer_code, 'layer_label', layer_label, 'map_type', map_type, 'overlap_ratio', overlap_ratio)) FROM soils), '[]'::jsonb),
              'landslides', COALESCE((SELECT jsonb_agg(jsonb_build_object('source_key', source_key, 'feature_code', feature_code, 'feature_label', feature_label, 'distance_meters', distance_meters)) FROM landslides), '[]'::jsonb),
              'contaminated_sites', COALESCE((SELECT jsonb_agg(jsonb_build_object('object_id', object_id, 'distance_meters', distance_meters)) FROM contaminated), '[]'::jsonb),
              'protected_areas', COALESCE((SELECT jsonb_agg(jsonb_build_object('nvr_id', nvr_id, 'name', name, 'protection_type', protection_type, 'distance_meters', distance_meters)) FROM protected), '[]'::jsonb)
          ) INTO result;

          RETURN result;
      END;
      $$ LANGUAGE plpgsql;
    
    `);
    console.log('GIS stubs and functions applied.');
  } catch (err) {
    console.error('Failed to apply GIS stubs', err);
    throw err;
  } finally {
    await client.end();
  }
}

export async function ensureTestAdminUser(): Promise<void> {
  const adminUsername = String(process.env.ADMIN_CONSOLE_USERNAME || 'admin').trim() || 'admin';
  const { ensureAdminConsoleUser } = await import('../../server/repositories/userRepository.js');
  await ensureAdminConsoleUser(adminUsername);
  console.log('Test admin user ready:', adminUsername);
}

/** Same id as tests/e2e/support.ts — must live in admin org for bootstrap/module access. */
export async function ensureE2ESeedProject(): Promise<void> {
  const adminUsername = String(process.env.ADMIN_CONSOLE_USERNAME || 'admin').trim() || 'admin';
  const { ensureAdminConsoleUser } = await import('../../server/repositories/userRepository.js');
  const { prisma } = await import('../../server/db/prisma.js');
  const authUser = await ensureAdminConsoleUser(adminUsername);
  const projectId = 'test-project-001';

  await prisma.project.upsert({
    where: { id: projectId },
    create: {
      id: projectId,
      organisationId: authUser.organisationId,
      propertyDesignation: 'Testfastighet 1:1',
      status: 'ACTIVE',
    },
    update: {
      organisationId: authUser.organisationId,
      propertyDesignation: 'Testfastighet 1:1',
      status: 'ACTIVE',
    },
  });

  await prisma.projectMember.upsert({
    where: {
      projectId_userId: {
        projectId,
        userId: authUser.id,
      },
    },
    create: {
      projectId,
      userId: authUser.id,
      accessRole: 'OWNER',
    },
    update: {
      accessRole: 'OWNER',
    },
  });

  console.log('E2E seed project ready:', projectId);
}
