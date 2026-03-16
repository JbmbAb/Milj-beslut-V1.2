-- 01-extensions.sql
-- Loaded automatically by docker-entrypoint-initdb.d on first container start.
-- Creates all PostgreSQL extensions required by the Miljöbeslut application.

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS postgis_topology;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS vector;
