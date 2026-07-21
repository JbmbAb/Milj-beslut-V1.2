-- Create Extensions
CREATE EXTENSION IF NOT EXISTS postgis;

-- Create stubbed GIS tables for production/test environment
-- These are required for spatial analysis flows until full data is imported.

CREATE SCHEMA IF NOT EXISTS "env";
CREATE SCHEMA IF NOT EXISTS "core";

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

-- Note: The service uses sgu_soil_type_25k_100k but some admin reports look for sgu_soil_type
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

CREATE TABLE IF NOT EXISTS "env"."water_protection_area" (
    id SERIAL PRIMARY KEY,
    name TEXT,
    geom geometry(MultiPolygon, 3006)
);

CREATE TABLE IF NOT EXISTS "public"."spatial_migrations" (
    id SERIAL PRIMARY KEY,
    "fileName" VARCHAR(255) NOT NULL,
    "appliedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    "durationMs" INTEGER
);