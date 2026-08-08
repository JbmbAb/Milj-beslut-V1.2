# ADR — Spatial Query Contract (Magic Moment)

## Status
Accepted (application chain freeze; physical EXPLAIN tuning follows E2E)

## Priority
Above TEXT-L3 rechunk. Goal: PostGIS → LU → UI product proof.

## Decision

```text
PostGIS
  → SpatialProviderPostGIS
  → SpatialQueryContract (+ SpatialQueryBudget)
  → SpatialEvidenceArtifact (TV-S1 identity)
  → LU Rule Engine / ExecutionKernel
  → LocalizationAssessmentArtifact
  → LU API
  → LuWorkspace
```

### Budget (fail-closed)

`SpatialQueryBudget`: `max_layers`, `max_features_per_layer`, `max_distance_meters`, `timeout_ms`, `max_bytes`.

Unknown layers → `REJECT_SPATIAL_LAYER`. Over budget → `REJECT_SPATIAL_BUDGET`.

### Property lookup

`property_ref` → CAS `LU_PROPERTY_CONTEXT` → SWEREF99 TM coordinates. WGS84 sites transformed via PostGIS `ST_Transform` once, then stored.

### Evidence identity

`buildSpatialEvidenceContentHash` (SV-I02/I06). `retrieved_at` / correlation `query_id` are provenance, not identity.

CAS put is idempotent by content hash: re-query with the same identity returns the existing artifact and does not rewrite wall-clock provenance (WORM).

## Non-goals (now)

- Full corpus TEXT-L3 rechunk
- New environmental layers
- Premature caching / denormalization
- Index spam without EXPLAIN

## Evidence

`packages/spatial-provider-postgis/tests/LUMagicMomentPostGIS.test.ts`  
Production seed path: `src/application/generate-localization-report.usecase.ts`
