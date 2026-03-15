-- Basala GIS- och sökextensions för repoets PostGIS-spår.
-- Kör denna manuellt i rätt miljö. Ingen live-körning sker automatiskt från applikationen.

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

CREATE SCHEMA IF NOT EXISTS stage;
CREATE SCHEMA IF NOT EXISTS core;
CREATE SCHEMA IF NOT EXISTS admin;
CREATE SCHEMA IF NOT EXISTS env;
CREATE SCHEMA IF NOT EXISTS hydro;
CREATE SCHEMA IF NOT EXISTS infra;
