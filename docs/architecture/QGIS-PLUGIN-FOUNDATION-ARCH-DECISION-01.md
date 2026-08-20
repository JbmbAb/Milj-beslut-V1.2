# QGIS-PLUGIN-FOUNDATION-ARCH-DECISION-01

**Status:** FROZEN / OWNER-APPROVED.

This freezes the architecture, scope, and boundaries for the QGIS integration track before any
plugin implementation starts. It exists so Codex has an executable authority to build against
rather than a chat transcript — the QGIS track has enough real negative boundaries (LU/evidence
authority, capability trust, contract scope) that starting from prose alone risks starting right
and drifting wrong.

## Unit order (frozen)

```
1. QGIS-FEATURE-IDENTITY-RECON-01   -- small, read-only, blocking
2. QGIS-PLUGIN-FOUNDATION-01        -- 2-3 real layers, end-to-end
3. QGIS-PLUGIN-FOUNDATION-BREADTH-01 -- catalog coverage expansion
```

No later unit starts before the earlier one is proven. In particular, `feature_id` is NOT frozen
as a contract field until `QGIS-FEATURE-IDENTITY-RECON-01` has answered stability for the real
pilot layers.

## 1. QGIS-FEATURE-IDENTITY-RECON-01

Read-only reconnaissance. No plugin code, no contract freeze. For each candidate pilot layer
(property, building, protected area), answer directly against the real read-model source
(`mapLayerCatalog.ts`, the tables/views it reads from, `gis.routes.ts`):

- Which field is used today as the feature id?
- Is it authority/source-derived, or DB-generated (e.g. an import `gid` / serial PK)?
- Is it stable across reload/reimport of the same source data?
- Can the same real-world object receive a new id after a rebuild?
- Is the id unique nationally, or only within its own layer/table?

**Default until proven otherwise:** a bare `gid`-style import id is NOT promoted to canonical
`feature_id`. The fallback shape is:

```
layer_id
source_feature_id
```

and only once the combination is verified stable across reload:

```
feature_ref = layer_id + source_feature_id
```

Output of this unit is a short written answer per pilot layer, not code. `QGIS-PLUGIN-
FOUNDATION-01` does not start until this exists.

## 2. QGIS-PLUGIN-FOUNDATION-01

A real, working PyQGIS plugin foundation, proven end-to-end on 2-3 real layers — not a shell, not
a mock. Pilot layers: **property**, **building**, **protected area** (or the nearest equivalent
confirmed available by the recon).

Proof chain required, per pilot layer:

```
catalog
  -> BBOX request
  -> QGIS feature/layer
  -> stable feature identity (per RECON-01)
  -> provenance panel (source, dataset_version, timestamp)
  -> styling
  -> self-describing export (GeoPackage/GeoJSON carrying provenance in the file itself,
     not only in a sidecar)
```

Order of implementation within the slice matters: **provenance before styling.** The first
working vertical slice should be connect -> select read-model layer -> load BBOX -> inspect
feature -> see source + dataset version + provenance -> export with provenance intact -> styling
— not a pretty map first. This is the sequence that matches what the platform is actually for.

Also in scope for this unit: plugin shell, connection/configuration, standardized project
generation, visual QA tooling, controlled export.

### Export self-description

Exports must carry their own provenance, not rely on a sidecar file surviving alongside them.
For GeoPackage: a `_mimer_export_metadata` layer/table with `export_id`, `created_at`, `layer_id`,
`dataset_version`, source authority, source/reference, CRS, export contract version. For GeoJSON:
metadata at `FeatureCollection` level where the consuming tool tolerates it, otherwise clearly
Mimer-namespaced properties. The exact shape is proven against real QGIS export/reimport
behavior before being frozen — not designed abstractly first.

### Audit

Server-side only. The plugin sends ordinary authenticated requests; the server logs `actor`,
`layer_id`, `bbox`/request scope, `timestamp`, and export yes/no. A client-side audit log is not
an audit log — it can be bypassed by anyone who controls their own local plugin installation.

## 3. QGIS-PLUGIN-FOUNDATION-BREADTH-01

Catalog coverage expansion once the foundation slice is proven. Same contract, same boundaries,
no new capability surface. Not detailed further here — scoped when reached.

## Hard invariants (apply to all three units)

```
QGIS is presentation / spatial QA only.
QGIS is not canonical LU authority.

/api/geodata/* and /api/layers/*
  -> READ MODEL ONLY

/api/spatial/evidence
  -> FORBIDDEN
```

QGIS (plugin or any server-side surface built for it) must never:

- construct a `SpatialEvidenceArtifact`
- construct a `LocalizationAssessmentArtifact`
- create a verdict
- write to CAS
- reconstruct canonical LU evidence directly from PostGIS

`/api/geodata/*` and `/api/layers/*` are read models useful for exploration and QA. They are
never canonical LU presentation, and the plugin must never represent them as assessment grounds.

## ViewerCapability — prepare for V2, do not activate against V1

The canonical LU assessment/evidence tab in the plugin is **LOCKED** at build time, registered
but inactive.

```
Canonical LU assessment UI:
  LOCKED

Future unlock:
  ViewerCapability V2 only

Current ViewerCapability V1:
  MUST NOT be treated as sufficient production authority
```

The existing `ViewerCapabilityArtifact` / `admitViewerCapability` admission pattern
(`packages/mps-compliance/src/artifacts/ViewerCapabilityArtifact.ts`,
`server/modules/localization/installLocalizationViewerCapability.ts`) is the correct model to
reuse for this gate **once V2 exists** — a signed, release-bound, time-windowed capability with
server-side admission, no client-side unlock flag. V1 is known to lack a valid viewer trust-root
and full attestation, so binding the LOCKED tab against V1 now would only relocate the gap, not
close it. No LU/evidence UI activation is wired against V1 in this track.

## Neutral read-model contract V1 — kept narrow

```
ReadModelFeatureCollectionV1

presentation_kind = "read_model"
layer_id
source/stable feature reference   (per QGIS-FEATURE-IDENTITY-RECON-01)
geometry
explicit CRS
dataset_version
provenance
attributes
```

Explicitly excluded from this contract:

- **No `canonical_assessment` variant or union member.** A future, separately versioned DTO from
  `P3-LU-PRESENTATION-BOUNDARY-01` covers canonical LU presentation when that boundary exists.
  Keeping `ReadModelFeatureCollectionV1` single-purpose makes mixing the two impossible rather
  than just unlikely.
- **No speculative pagination fields** (`next_page_token` or similar). If real volume testing
  later shows a need, that is a new versioned endpoint (V2, or a dedicated MVT endpoint) — HTTP/
  API versioning is cheaper than carrying empty future-proofing fields through every client. The
  server implementation should not assume an entire layer always fits one GeoJSON response, but
  that is an implementation concern, not a wire field to reserve now.
- **No Blender-specific fields** (`mesh_generation_version`, `lod`, `material_profile`,
  `local_origin`). These are the Blender adapter's own concerns, not properties of canonical or
  read-model data, and are not reserved in the shared contract until a real Blender integration
  exists to validate what it actually needs.

## Cesium and Blender compatibility

Presentation-client-neutral contracts only. Client-specific concerns live in each future adapter,
not in the shared contract.

```
No Cesium implementation in this unit.
No Blender implementation in this unit.
No speculative client-specific fields in shared contracts.
```

```
Neutral read-model contract V1 (this document):
  layer_id, stable feature reference, geometry, explicit CRS, dataset_version, provenance,
  attributes

QGIS owns:
  QgsFeature, QML styling, project structure

Cesium (later) owns:
  Entity/Primitive, WGS84/ECEF conversion, web styling/LOD

Blender (later) owns:
  local origin, mesh generation, materials, LOD
```

## Executable boundary guard — required, not documentation-only

A boundary described only in this document is not enforced. This unit requires a CI-enforced
guard (AST/import-boundary check where feasible for the TypeScript server surface; a static guard
for the Python plugin) that fails the build if QGIS-facing server code or plugin code references
any forbidden path:

```
/api/spatial/evidence
SpatialEvidenceArtifact construction
LocalizationAssessmentArtifact construction
CAS put/write
verdict generation
PostGIS reconstruction of LU evidence
```

Read-model responses additionally carry `presentation_kind: "read_model"` explicitly, and a test
verifies that `/api/geodata/*`/`/api/layers/*` can never emit anything else today.

## What this document does not decide

- The exact shape of export self-description (proven against real QGIS behavior in
  `QGIS-PLUGIN-FOUNDATION-01`, not designed here).
- `QGIS-PLUGIN-FOUNDATION-BREADTH-01`'s scope beyond "expand coverage, same boundaries."
- Anything about `P3-LU-PRESENTATION-BOUNDARY-01` or `ViewerCapability V2` themselves — both are
  prerequisites this track depends on, not part of it.
