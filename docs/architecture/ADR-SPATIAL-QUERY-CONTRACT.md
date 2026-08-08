# ADR — Spatial Query Contract (Magic Moment)

## Magic Moment

**FROZEN / PROVEN**

Commit: `9c200a7` — `feat(lu): productionize PostGIS Magic Moment vertical slice`

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

Application chain is locked. Do not reopen for polish unless a proven product defect appears.

## Benchmark

**Baseline only. No optimization performed.**

| Field | Value |
|---|---|
| Artifact | `docs/ops/benchmarks/spatial-magic-moment-latest.json` |
| Canvas | `docs/ops/benchmarks/spatial-magic-moment-benchmark.canvas.tsx` |
| Test DB | `riskguard_test` |
| Property | `VÄSTERÅS 1:1` |
| Iterations | 51 (+ 3 warmup) |
| Script | `scripts/benchmark/spatial-magic-moment-bench.mjs` |

### Interpretation

Seq Scan is expected because test spatial tables contain only 1–2 rows.
This benchmark does **not** establish production spatial performance.

It does **not** mean “PostGIS is optimized.”
It does **not** mean “missing GiST is a problem.”

It records that the current small test database is fast for the Magic Moment path.

### Next performance gate

1. Repeat benchmark after realistic spatial layer population.
2. Evaluate GiST / index strategy **only** from that measurement.

Until then:

```text
PostGIS optimization          ⏸ NO-GO
Realistic spatial benchmark   ⏳ FUTURE GATE
```

## Contracts (frozen with Magic Moment)

### Budget (fail-closed)

`SpatialQueryBudget`: `max_layers`, `max_features_per_layer`, `max_distance_meters`, `timeout_ms`, `max_bytes`.

Unknown layers → `REJECT_SPATIAL_LAYER`. Over budget → `REJECT_SPATIAL_BUDGET`.

### Property lookup

`property_ref` → CAS `LU_PROPERTY_CONTEXT` → SWEREF99 TM coordinates. WGS84 sites transformed via PostGIS `ST_Transform` once, then stored.

### Evidence identity

`buildSpatialEvidenceContentHash` (SV-I02/I06). `retrieved_at` / correlation `query_id` are provenance, not identity.

CAS put is idempotent by content hash: re-query with the same identity returns the existing artifact and does not rewrite wall-clock provenance (WORM).

## Explicitly paused

- TEXT-L3 v2.3 rechunk
- Cache layers
- New spatial layers
- Blind indexing
- Full corpus migration
- Speculative PostGIS “optimization”

## Evidence

- Backend: `packages/spatial-provider-postgis/tests/LUMagicMomentPostGIS.test.ts`
- E2E chain: `packages/spatial-provider-postgis/tests/LUMagicMomentE2E.chain.test.ts`
- UI E2E: `tests/components/luWorkspace.magicMoment.e2e.test.tsx`
- Usecase: `src/application/generate-localization-report.usecase.ts`
- Benchmark baseline: `docs/ops/benchmarks/spatial-magic-moment-latest.json`
