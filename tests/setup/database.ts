import { execSync } from 'child_process';
import pkg from 'pg';
const { Client } = pkg;
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export default async () => {
  console.log('Setting up test database...');

  // 1. Ensure the database schema is up to date
  execSync('npx prisma migrate deploy', { stdio: 'inherit' });

  // 2. Clean data from all tables managed by Prisma
  // This is much faster and safer than `migrate reset`
  const tableNames = await prisma.$queryRaw<
    Array<{ tablename: string }>
  >`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`;

  const tablesToTruncate = tableNames
    .map(({ tablename }) => tablename)
    .filter((name) => name !== '_prisma_migrations'); // Don't truncate migrations table

  if (tablesToTruncate.length > 0) {
    try {
      const truncateQuery = `TRUNCATE TABLE ${tablesToTruncate
        .map((name) => `"public"."${name}"`)
        .join(', ')} RESTART IDENTITY CASCADE;`;
      await prisma.$executeRawUnsafe(truncateQuery);
      console.log('Successfully truncated Prisma-managed tables.');
    } catch (error) {
      console.error('Error truncating tables:', error);
      // Fallback to reset if truncate fails (e.g., complex FK issues not handled by CASCADE)
      console.log('Falling back to `prisma migrate reset` due to truncation error.');
      execSync('npx prisma migrate reset --force --skip-generate', { stdio: 'inherit' });
    }
  }

  // MANUALLY RE-APPLY GIS STUBS (since they are not in schema.prisma and migrate reset drops them)
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query('CREATE EXTENSION IF NOT EXISTS "postgis";');
    await client.query('CREATE EXTENSION IF NOT EXISTS "postgis_raster";');
    await client.query('CREATE EXTENSION IF NOT EXISTS "unaccent";');
    await client.query('CREATE EXTENSION IF NOT EXISTS "pg_trgm";');
    await client.query('CREATE SCHEMA IF NOT EXISTS "env";');
    await client.query('CREATE SCHEMA IF NOT EXISTS "core";');
    await client.query('CREATE SCHEMA IF NOT EXISTS "topo10";');

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
          geom geometry(MultiPolygon, 3006)
      );

      CREATE TABLE IF NOT EXISTS "env"."natura2000_area" (
          external_id TEXT PRIMARY KEY,
          site_name TEXT,
          category TEXT,
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
          jg2 TEXT,
          jg2_tx TEXT,
          karttyp TEXT,
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

      CREATE TABLE IF NOT EXISTS "public"."spatial_migrations" (
          id SERIAL PRIMARY KEY,
          "fileName" VARCHAR(255) NOT NULL,
          "appliedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          "durationMs" INTEGER
      );
    `);
    console.log('GIS stubs and functions re-applied.');
  } catch (err) {
    console.error('Failed to re-apply GIS stubs and functions', err);
  } finally {
    await client.end();
  }

  console.log('Test database is ready.');
};
