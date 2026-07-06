# PostGIS Scalability & Optimization Report

Date: 2026-05-24
Scope: PostGIS queries, spatial import/index scripts, and large-table readiness for 500M+ rows.

## Executive Summary

The current PostGIS implementation is good for normal production GIS workloads, but it is not yet proven robust for 500,000,000 rows. The main gap is not the query syntax in the service layer. Most spatial lookups already use index-friendly predicates such as `ST_DWithin`, `ST_Intersects`, bounding-box prefilters, and point/envelope transforms into SRID 3006.

The main 500M risk is physical database design:

- Time-series/write-heavy Prisma tables are still flat tables.
- Spatial partitioning exists only for `env.sgu_ground_layer`.
- Several high-traffic map endpoints transform/simplify/export geometries on demand.
- Parallel API orchestration can multiply database work per request without a concurrency budget.
- There is no committed EXPLAIN/BUFFERS regression workflow for critical spatial queries.

Conclusion: the platform has the right PostGIS direction, but 500M-row robustness requires partitioning, query-plan verification, controlled concurrency, and precomputed/cached map outputs.

## What Is Already Good

- `scripts/import/import-librarian-manifest.ts` runs **GiST + BRIN + VACUUM ANALYZE** on production tables after promote via `applyPostImportIndexing()` in `importLibrarianQa.ts`.
- Bulk import sessions raise `maintenance_work_mem` / `work_mem` only during Librarian index work (`setBulkImportSession`); ogr2ogr uses `PGOPTIONS` on its own libpq connection.
- `server/services/sguRiskService.ts` runs independent SGU soil and landslide lookups in parallel.
- `server/services/spatialAuditService.ts` runs protected-area lookup, distance-to-water, and SGU audit in parallel.
- Most point queries transform the input point/envelope rather than transforming the indexed geometry column in `WHERE`.
- Bbox map queries often use `geom && envelope` before `ST_Intersects`, which helps GiST pruning.
- `prisma/spatial/001_gist_indexes.sql` defines GiST indexes for core environmental layers.
- `scripts/db/post-import-indexing.sql` includes a stronger post-import indexing strategy with GiST, BRIN, and `VACUUM ANALYZE`.
- `prisma/spatial/002_partition_large_geo_tables.sql` starts a spatial grid partitioning pattern for `env.sgu_ground_layer`.

## Critical Gaps For 500M Rows

### 1. Flat time-series tables

The following models are not partitioned in `prisma/schema.prisma`:

- `GpsPosition`
- `AuditTrail`
- `SearchQueryLog`
- `PropertyAccessLog`
- likely future/event-heavy records such as `SubmissionStatusEvent`, `AuthorityInboxEvent`, and document/search queues

Current indexes such as `@@index([bookingId, timestamp])`, `@@index([entityType, timestamp])`, and `@@index([projectId, timestamp])` are useful, but at 500M rows they do not solve:

- index bloat
- slow retention deletes
- long vacuum cycles
- expensive global index maintenance
- poor cache locality for recent operational data

Recommendation: range partition large append-only/event tables by time, usually monthly. For high-ingest GPS data, weekly or daily partitions may be justified.

### 2. Spatial partitioning is incomplete

`env.sgu_ground_layer` has a 100 km grid partition design, but other large spatial tables are still indexed as monoliths.

Candidates for spatial partitioning or subdivision:

- `env.sgu_soil_type_25k_100k`
- `env.sgu_ground_layer_1m`
- `env.sgu_well`
- `core.lm_mark`
- `core.lm_byggnad`
- `topo10.*`
- hydrology/catchment tables
- national protected-area and flood-risk layers

Recommendation: choose per table:

- Static national polygon layers: ingest with `ST_Subdivide`, then GiST index.
- Very large point/line layers: GiST on geometry plus BRIN on sequential id/import id.
- Very large multi-theme datasets: spatial grid partitioning only where partition pruning can be made explicit.

### 3. Map endpoints do heavy geometry work per request

Several map endpoints repeatedly do:

- `ST_Simplify` or `ST_SimplifyPreserveTopology`
- `ST_Transform(..., 4326)`
- `ST_AsGeoJSON`
- high row limits around 1500-3000

This is acceptable at small/medium scale, but expensive under many users and large tables.

Recommendation:

- Use vector tiles (`ST_AsMVT`) for map display wherever possible.
- Precompute simplified geometry columns or materialized views per zoom/detail level.
- Keep GeoJSON endpoints for audit/export/detail, not primary map rendering at scale.
- Add response caching by `layerKey + bbox + zoom/detail + datasetVersion`.

### 4. Parallel service calls need a concurrency budget

The new service-level parallelism reduces latency for one request, but it can increase total database pressure. One user action can now trigger multiple simultaneous spatial scans.

Recommendation:

- Add a lightweight DB concurrency limiter around heavy spatial queries.
- Set `statement_timeout` for request-path spatial queries.
- Keep separate connection pools for interactive API, import jobs, and background maintenance.
- Prefer `Promise.allSettled` or isolated fallbacks where partial results are acceptable.

### 5. No committed query-plan verification

The code has good query intent, but 500M readiness must be measured with:

```sql
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
```

for the critical query set:

- point-in-polygon: SGU ground layer
- nearby features: SGU landslide, water, heritage
- protected area overlap
- bbox layer fetches
- vector tile endpoints
- GPS route/time range lookups

Recommendation: add a read-only script that captures plans for representative coordinates/bboxes and fails CI or ops checks when sequential scans appear on large tables.

## Specific Query Optimizations

### Point transform reuse

Many point queries repeat:

```sql
ST_Transform(ST_SetSRID(ST_MakePoint(lng, lat), 4326), 3006)
```

within the same query. Use a `WITH point AS (...)` CTE consistently, as already done in some services. This is not the biggest bottleneck, but it improves readability and avoids repeated expression evaluation.

### KNN nearest-neighbor ordering

For nearest-feature queries, prefer:

```sql
ORDER BY geom <-> point.geom
```

when the use case is nearest N rows. Keep `ST_DWithin` when a hard review radius is legally meaningful.

### Generated or stored 3006 geometry

Avoid any pattern that transforms the table geometry in the `WHERE` predicate. Store operational geometry in SRID 3006 for Swedish national data and transform only input parameters or output geometries.

### Geometry simplification

For large polygon datasets, use precomputed detail levels:

- `geom` for exact analysis
- `geom_z12`
- `geom_z10`
- `geom_z8`

or materialized views keyed by layer/detail. Do not rely on request-time simplification for high-volume map usage.

## Recommended Implementation Plan

### Phase 1: Prove current plans

Add an ops script:

- checks row counts
- checks GiST/BRIN indexes
- runs `EXPLAIN (ANALYZE, BUFFERS)` for key queries
- reports sequential scans on large tables
- reports missing statistics/analyze age

### Phase 2: Partition append-only tables

Create SQL migrations for:

- `GpsPosition` range partitioned by `timestamp`
- `AuditTrail` range partitioned by `timestamp`
- `SearchQueryLog` range partitioned by `createdAt`
- `PropertyAccessLog` range partitioned by `timestamp`

Initial implementation: `scripts/db/partition-realtime-tables.sql`.

This is an ops migration rather than a regular Prisma migration because PostgreSQL cannot safely convert an existing large heap table into a range-partitioned parent without a controlled cutover. For small/current tables, the script can be rehearsed in staging and run during a write pause. For already-large tables, use the same DDL shape but copy legacy rows in batches before cutover.

Operational support:

- `npm run db:partition:verify` checks partition parents, indexes, registry triggers, row counts, default partitions, and near-future partitions.
- `npm run db:partition:maintain -- --apply --months-forward=18` creates missing future monthly partitions after cutover.

Example pattern:

```sql
CREATE TABLE public."GpsPosition_partitioned" (
  LIKE public."GpsPosition" INCLUDING DEFAULTS INCLUDING CONSTRAINTS
) PARTITION BY RANGE ("timestamp");

CREATE TABLE public."GpsPosition_2026_05"
PARTITION OF public."GpsPosition_partitioned"
FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');

CREATE INDEX ON public."GpsPosition_2026_05" ("bookingId", "timestamp");
CREATE INDEX ON public."GpsPosition_2026_05" USING BRIN ("timestamp") WITH (pages_per_range = 128);
```

Note: Prisma does not model partitioning cleanly. Keep these as explicit SQL migrations and avoid destructive Prisma re-generation over partitioned parents.

### Phase 3: Harden spatial imports

Standardize import pipeline:

- load into staging
- validate SRID and geometry validity
- `ST_MakeValid` only where needed
- `ST_Subdivide` complex polygons before final insert
- build GiST/BRIN after bulk load
- run `VACUUM ANALYZE`

### Phase 4: Move maps to tiles/caches

Use vector tiles for large datasets and reserve GeoJSON for detail panels and exports. Add CDN/server cache keys based on layer, bbox/tile, zoom, and dataset version.

### Phase 5: Operational limits

Add:

- `statement_timeout`
- import/job pool separate from API pool
- per-request spatial concurrency limiter
- slow query logging and `pg_stat_statements`
- maintenance windows for `REINDEX CONCURRENTLY`, `VACUUM`, and partition detach/drop

## Answer To The 500M Question

No, the current system should not be considered robust for 500M rows yet.

It is optimized enough to be a solid baseline, and several query patterns are already correct. But 500M rows requires a deliberate physical storage strategy: partitioned append-only tables, subdivided and/or partitioned static GIS layers, query-plan regression checks, controlled concurrency, and precomputed map outputs.

The next highest-value change is not another `Promise.all`; it is completing **partition cutovers** for national-scale tables and EXPLAIN-based validation. Librarian already automates post-promote GiST/BRIN indexing.

### Cloud Native (GCP) — not local Docker requirements

- **PgBouncer / connection pooling:** use Cloud SQL Auth Proxy + managed pool or AlloyDB; optional Prisma Accelerate in production. Local Fury dev: Prisma `pool_size` only — status ❌ for PgBouncer locally is intentional.
- **Read replicas:** provision when map/API read load must not compete with Librarian promote; not required for Tier 1–2 import on a single dev Postgres instance.
