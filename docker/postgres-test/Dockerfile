# Test database image: PostgreSQL 16 with PostGIS 3.4 + pgvector + pg_trgm + unaccent
#
# Build and push to GHCR:
#   docker build -t ghcr.io/jbmbab/milj-beslut-postgres-test:16 docker/postgres-test
#   docker push ghcr.io/jbmbab/milj-beslut-postgres-test:16
#
# The image is consumed by CI jobs that need a real PostgreSQL environment
# with all extensions the application depends on.

FROM postgis/postgis:16-3.4

# Install pgvector from the official APT repository
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       postgresql-16-pgvector \
    && rm -rf /var/lib/apt/lists/*

# Pre-load all required extensions so initdb auto-creates them.
# Each line in docker-entrypoint-initdb.d/ is run once on first startup.
COPY initdb/ /docker-entrypoint-initdb.d/
