# ADR — Spatial Presentation & Evidence Contract (Cesium & Unified Engine)

## Status

**ACCEPTED / SEQUENCE FROZEN**, with Section 2(a) amended — see _Amendment 1_ below.

## Amendment 1 (2026-09-06) — Click-to-Evidence superseded

Owner ruling, recorded as part of `CESIUM-CANONICAL-SPATIAL-PRESENTATION-3D-V1`.

**The core principle of this ADR remains NORMATIVE and unchanged:** Cesium is a pure presentation
of verified/canonical spatial information. It is not an independent GIS authority, not a parallel
query engine, and PostGIS remains a rebuildable read-model surface rather than authority.

**Section 2(a) — the literal Click-to-Evidence sequence — is ruled STALE and is superseded.** It
required that a map click "must trigger the exact same SpatialQueryContract interface used by the
LU Rule Engine, returning standard SpatialEvidenceArtifact[] tokens". Under the CAS-as-authority
model that arrived after this ADR was written, re-querying PostGIS at click time is precisely the
bypass the rest of this document forbids: it would make an ordinary presentation gesture mint new
evidence outside the governed path. An ordinary click must NOT create a new SpatialQueryContract
execution or a new SpatialEvidenceArtifact.

Successor semantics:

| Case                  | Path                                                                                                                     |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **Presentation**      | canonical entity identity + governed/read-model geometry → presentation projection → Cesium                              |
| **Existing evidence** | canonical artifact/evidence reference → presentation projection → Cesium / evidence UI                                   |
| **New analysis**      | explicit user analysis request → SpatialQueryContract → SpatialEvidenceArtifact → canonical evidence path → presentation |

**`SpatialEvidenceArtifact` semantics are UNCHANGED and remain frozen by this amendment.** In
particular, the worked example in Section 2 showing a per-feature measured distance ("183 m") is
not buildable from admitted v1 semantics and is not to be manufactured by presentation:
`SPATIAL_RESULT_SEMANTICS_POLICY_V1` admits only `EXISTENCE_WITHIN_DISTANCE`, which carries no
geometry, and its `distance_meters` is the **query buffer**, not a measured distance to a feature.
Presentation therefore surfaces that value as `query_distance_meters` and fabricates nothing. A
genuine measured distance requires admitting a new semantics kind (`FEATURE_GEOMETRY` or
`DISTANCE_WITNESS`) with its own identity — a separate governance decision, not a presentation
change.

Section 5 (3D formats) remains unimplemented. The canonical contract carries optional, all-nullable
3D fields and an optional governed model reference so that a future 3D derivation attaches without
replacing the contract; `null` means unknown and must never be rendered as a measured value.

Implementing contract:
`packages/mps-lu/src/viewer/CanonicalSpatialPresentationContract.ts`.

## Context & Motivation

As the platform scales to support Sweden's complete national geodata coverage, presenting complex geospatial datasets (such as 4.4M property polygons, building footprints, and environmental risk buffers) to clients like CesiumJS without degrading performance is a critical challenge.

A naive approach of performing ad-hoc spatial queries with dynamically transformed coordinates (e.g. `ST_Transform(geom, 4326) && ...`) in the SQL `WHERE` clause completely invalidates PostGIS spatial indices (GiST). Furthermore, querying separate data pipelines or clipping datasets regionally specifically for presentation creates multiple conflicting sources of truth.

## Architectural Decision

We formalize the **Unified Spatial Evidence & Presentation Architecture** where **Cesium is a pure visualizer of verified evidence**, rather than an independent GIS query engine.

### 1. Unified Architecture Pipeline

The system is split into a single data flow where all spatial and presentation needs are served by the same frysta PostGIS baseline:

```text
                  GEO_Master_Archive (Canonical Truth)
                           │
                           ▼
                 ┌───────────────────┐
                 │   PostGIS Master  │
                 │                   │
                 │ property surfaces │
                 │ boundaries        │
                 │ buildings         │
                 │ terrain           │
                 │ wells             │
                 │ soil              │
                 │ protected areas   │
                 └─────────┬─────────┘
                           │
                           ▼
                 SpatialQueryContract (Unified Core Interface)
                           │
              ┌────────────┴────────────┐
              │                         │
              ▼                         ▼
       LU Evidence Engine          Map/3D API
              │                         │
              ▼                         ▼
 SpatialEvidenceArtifact[]          CesiumJS
                                      │
                         ┌────────────┼───────────┐
                         ▼            ▼           ▼
                    boundaries    buildings    terrain
```

### 2. The Click-to-Evidence Principle

Clicking a property or geographical point in Cesium must trigger the exact same `SpatialQueryContract` interface used by the LU Rule Engine, returning standard `SpatialEvidenceArtifact[]` tokens.
This links visual interactive map components directly to cryptographic evidence:

- Every active map asset / element in Cesium is assigned an `artifact_id` and an `evidence_ref` (SHA-256 hash).
- Map interaction results in an immediate rendering of the associated `Finding` and `Rule` details:

```text
Click on Property
       ↓
ST_DWithin Query via SpatialQueryContract
       ↓
Returns SpatialEvidenceArtifact[]
       ↓
┌──────────────────────────────┐
│ Orsa Stackmora 3:12          │
│                              │
│ Spatial evidence             │
│                              │
│ 🟠 SGU-brunn                 │
│    183 m                     │
│                              │
│ Rule                         │
│ LU-WELL-500M                 │
│                              │
│ Finding                      │
│ "Brunn inom 500 m"           │
│                              │
│ [Visa evidens] [Visa regel]  │
└──────────────────────────────┘
```

### 3. Decoupling Identity and Geometry

We strictly separate **Property Identity** from **Property Geometry**:

- **Property Identity:** Core database (`core.property_unit`) contains unique identification metadata, county codes, and administrative bounds.
- **Property Geometry:** Spatial database (`env.registerenhetsomradesytor`) stores high-resolution spatial polygons.
  This decoupling prevents heavy polygon loads from choking identity queries and ensures high-performance lookups.

### 4. Optimal PostGIS Query Practice

To protect GiST indices on the database, coordinates in query filters MUST NOT be transformed dynamically in the `WHERE` clause.

- **Incorrect (Index-breaking):**
  ```sql
  WHERE ST_Transform(geom, 4326) && ST_MakeEnvelope($1, $2, $3, $4, 4326)
  ```
- **Correct (Index-preserving):** Transform the search window _into the native layer CRS (3006)_ once, letting PostGIS perform index-scans natively, and then transform only the returned subset:
  ```sql
  WHERE geom && ST_Transform(ST_MakeEnvelope($1, $2, $3, $4, 4326), 3006)
  ```

### 5. Scalable Presentation Layouts

Because loading millions of properties as raw GeoJSON over HTTP degrades browser performance, we map presentation formats to data types based on scale:

| Data Type                                     | Presentation Format       |
| --------------------------------------------- | ------------------------- |
| National Property Surfaces / Boundaries       | 3D Tiles                  |
| National Buildings                            | 3D Tiles                  |
| Terrain / Topography                          | Terrain/Elevation Tiles   |
| Active LU Query / Interactive Buffer          | GeoJSON / CZML / Entities |
| SpatialEvidence / Finding / Rule / Assessment | JSON via Evidence API     |

---

## Implications & Next Steps

1. **Prioritize Contracts:** Complete `SpatialQueryContract` and the general Evidence API before committing resources to heavy Cesium front-end optimizations.
2. **Unified Testbed (Millbygård):** Integrate the Millbygård sub-project as a clean consumer of the PostGIS master database. This tests orthofotos, elevation clipping, and 3D extrusion directly against production PostGIS, eliminating duplicate pipelines.
