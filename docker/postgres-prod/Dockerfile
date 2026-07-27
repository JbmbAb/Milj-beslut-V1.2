# Prod database image: PostgreSQL 15 with PostGIS 3.3 + pgvector
#
# Matches prisma migrations that require CREATE EXTENSION vector.
# Build locally via docker-compose.prod.yml (service: db).

FROM postgis/postgis:15-3.3

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       postgresql-15-pgvector \
    && rm -rf /var/lib/apt/lists/*
