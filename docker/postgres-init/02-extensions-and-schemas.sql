-- Körs automatiskt av PostgreSQL vid första start via Docker
-- Aktiverar nödvändiga extensions för Miljöbeslut.se

-- PostGIS (spatiala frågor, SGU-lager)
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS postgis_topology;

-- pgvector (AI-embeddings)
CREATE EXTENSION IF NOT EXISTS vector;

-- pg_trgm (trigrambaserad textsökning)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- unaccent (accent-okänslig sökning för svenska tecken)
CREATE EXTENSION IF NOT EXISTS unaccent;

-- Skapa env-schemat för SGU/spatialdata (separat från Prisma-schemat public)
CREATE SCHEMA IF NOT EXISTS env;
CREATE SCHEMA IF NOT EXISTS core;

-- Ge applikationsanvändaren rättigheter till env och core
GRANT ALL PRIVILEGES ON SCHEMA env TO riskguard;
GRANT ALL PRIVILEGES ON SCHEMA core TO riskguard;
GRANT ALL PRIVILEGES ON SCHEMA public TO riskguard;
