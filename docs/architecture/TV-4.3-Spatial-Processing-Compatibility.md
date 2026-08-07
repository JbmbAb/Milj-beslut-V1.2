# TV-4.3 — Spatial Processing Compatibility Requirements

| Field | Value |
| --- | --- |
| **Status** | **FRYST** (ACTIVE Final) |
| **Date** | 2026-08-07 |
| **Owner** | Spatial Governance Domain |
| **Type** | Compatibility requirements — constrains TV-4 physical design |
| **Depends on** | [TV-S1](./TV-S1-Spatial-Verification-Layer.md), [TV-3.0](./TV-3.0-PostgreSQL-Physical-Data-Strategy-Freeze.md), [ADR-MPS-CAS-STORAGE-BOUNDARY](./ADR-MPS-CAS-STORAGE-BOUNDARY.md) |
| **Non-goals** | Index tuning values, raster ingest execution, QGIS installation, capability implementation |

---

## 1. Purpose

TV-4.3 ensures that PostGIS physical design **enables** integration with open GIS
capabilities without touching the CAS authority model.

The point is not that QGIS should govern PostGIS. The point is to avoid optimizing
PostGIS in a way that later blocks raster analysis, municipal GIS compatibility, expert
review, spatial AI, or replayable GIS processes.

| Layer | Responsibility |
| --- | --- |
| PostGIS | Storage, indexing, spatial query, filtering, joins, materialized projections |
| QGIS / GDAL | Advanced analysis, raster, processing models, visualisation, human verification |
| CAS | Canonical spatial evidence (TV-S1) |

```
              CAS
               │
   Canonical Spatial Evidence
               │
   Spatial Verification Layer
               │
      +--------+--------+
      │                 │
   PostGIS            QGIS
   Execution          Processing
   Engine             Engine
```

---

## 2. Raster model (FRYST)

Raster is the largest opportunity and the largest way to accidentally create a second
authority. The model therefore splits **source** raster from **derived** raster.

```
Raster Source
      │
      +── CAS (original bytes, digest-addressed)
      │
      +── QGIS / GDAL processing
      │
      +── Derived Raster Artifact  ──► CAS
      │
      +── PostGIS metadata / projection
```

| Class | Where the bytes live | What PostGIS holds |
| --- | --- | --- |
| Source raster (Sentinel-2, historical maps, elevation) | Archive mount, digest-addressed in CAS | Out-db reference + metadata |
| Derived raster (indices, models, classifications) | CAS as artifact | `raster_layer_projection` row only |

Example derived artifact:

```json
{
  "artifact_type": "RasterEvidenceArtifact",
  "source_hashes": ["sentinel2_hash", "dem_hash", "soil_hash"],
  "algorithm": "wetness_index",
  "resolution": "10m",
  "result_hash": "..."
}
```

PostGIS projection row: `layer_id`, `bbox`, `srid`, `timestamp`, `artifact_hash`.

**Requirement SPC-R01 — No raster authority in PostGIS**

Derived raster results SHALL be CAS artifacts. PostGIS SHALL hold only the projection row.
Full raster processing pipelines SHALL NOT live inside PostgreSQL, because in-database
raster results are neither replayable nor rebuildable under PHYS-I06.

**Requirement SPC-R02 — Out-db rasters are digest-keyed**

An out-db raster row stores a **file path**, which makes the path load-bearing. That
conflicts with CAS-I03 (storage independence) and CAS-I06 (no identity from path).

The raster registry SHALL key on the content digest (`RasterRegistrationLog.sha256`), and
the file path SHALL be resolved through `CASPathResolver`. Moving or re-mirroring the
archive SHALL change a lookup path, never an identity.

**Requirement SPC-R03 — Explicit GDAL driver allowlist**

`postgis.gdal_enabled_drivers` SHALL be an explicit allowlist covering exactly the formats
in use. `ENABLE_ALL` is forbidden: the driver list is a security boundary against the
database reading arbitrary formats and locations.

---

## 3. Terrain and derived analysis (FRYST)

Slope, aspect, watershed, flow accumulation, and erosion risk are computed by the
processing engine and enter the platform as `SpatialEvidenceArtifact` (TV-S1 §5), with the
full engine fingerprint in the identity domain (SV-I03).

---

## 4. Topology checking (FRYST)

**Requirement SPC-R04 — Detection, not repair**

```
QGIS detects deviation
       │
Evidence Artifact
       │
Governance decision
```

A GIS client SHALL NOT repair geometry in place. Invalid polygons, overlaps, gaps, and
self-intersections are findings that become evidence; correction enters as new data with
supersession, never as a silent UPDATE against a projection.

---

## 5. Processing graphs (FRYST)

A municipal analysis chain (buffer → intersect water → intersect soil → classify) is a
versioned model:

```yaml
spatial_model:
  id: water_risk_v1
  engine: qgis
  steps: [buffer, intersect, classify]
  version: "1.0"
```

**Requirement SPC-R05 — Models are content-hashed, not string-versioned**

A human-assigned label such as `water_risk_v1` or `"1.0"` SHALL NOT be the model identity.
The serialized graph — steps, parameters, and order — SHALL be canonically hashed, and that
hash is what enters `SpatialEvidenceArtifact`. Otherwise a model can be edited while
keeping its label, and every artifact produced under the old graph becomes unverifiable
while still appearing valid. This is the same rule as C-02 for canonical versions.

---

## 6. PostGIS exposure requirements (FRYST)

| Area | Requirement |
| --- | --- |
| SRID | Declared per column; SWEREF99 TM (EPSG:3006) as platform default; no implicit reprojection |
| Geometry typing | Typmod-declared (`geometry(MultiPolygon,3006)`), not generic `geometry` |
| Validity | Geometries validated on admission; invalid geometry is a finding, not a silent fix |
| Primary key | Single-column PK on every layer a GIS client reads (required for the client to load a layer at all) |
| Views | GIS-readable views expose a stable unique key and a typed geometry column |
| Registry | `spatial_layer_registry`: `layer_id`, `source_artifact_hash`, `srid`, `geometry_type`, `valid_from`, `authority` |
| Data model | No proprietary data models; no GIS-vendor-specific dependencies in core |

**Requirement SPC-R06 — Registry is a projection**

`spatial_layer_registry` is a governance projection and SHALL be rebuildable from CAS and
governance metadata (PHYS-I06). It records which artifact a layer projects, never the
layer's authority itself.

**Requirement SPC-R07 — Read-only GIS role**

A read-only role SHALL exist for GIS clients, with default privileges configured **before**
the tables are created. Retrofitting means granting table by table indefinitely, and an
analyst connected as owner can mutate projections — which would break PHYS-I01 and SV-I05
in practice regardless of what the documents say.

---

## 7. Index strategy (FRYST as principle)

GIS clients issue bounding-box, extent, and intersection queries, so GiST on the geometry
column is central:

```sql
CREATE INDEX ON property_unit USING GIST (geom);
```

BRIN is appropriate for time series, raster metadata, and historical layers — **on the
condition** that physical row order correlates with the indexed column. BRIN on an
uncorrelated column is close to useless, so the TV-3.0 ground rule applies unchanged: no
index strategy without access-pattern proof. Concrete index values belong to TV-4.

---

## 8. Capability registry (FRYST)

```
spatial.buffer
        ├── PostGIS Provider
        └── QGIS Provider

spatial.raster_analysis
        └── GDAL / QGIS Provider

spatial.topology_check
        └── QGIS Provider
```

**Requirement SPC-R08 — Engine-neutral capability names**

Capabilities SHALL be named by operation (`spatial.buffer`), never by vendor
(`qgis.buffer`). Core SHALL carry no GIS-vendor-specific dependency. Providers are
substitutable; note that substituting an engine produces a new evidence identity, not an
equal one (TV-S1 §5.2).

---

## 9. Verified engine baseline (2026-08-07)

Measured against the running `miljobeslut-postgres` engine.

| Component | Value | Consequence |
| --- | --- | --- |
| PostGIS | 3.4.3 | — |
| GEOS | 3.9.0 | Identity input (SV-I03); older than PostGIS itself |
| PROJ | 7.2.1 | Identity input; governs SWEREF99 / RH2000 transformations |
| GDAL | 3.2.2 | Identity input for raster operations |
| `postgis_raster` | installed | Raster path available |
| `postgis_topology`, `postgis_sfcgal` | available, not installed | Can be enabled at any time; no build risk |
| `pgrouting` | **absent** | Network analysis requires an image change, not `CREATE EXTENSION` |
| `postgis.enable_outdb_rasters` | `true` | Out-db path enabled |
| `postgis.gdal_enabled_drivers` | **unset → 0 drivers enabled** | Out-db raster reads currently fail; SPC-R03 must be applied |
| Drivers shipped in image | `GTiff`, `COG`, `JP2OpenJPEG`, `PNG`, `JPEG`, `netCDF`, `HDF5`, `VRT`, `GPKG` | Sentinel-2 (JP2) and COG are readable once allowlisted |

**Requirement SPC-R09 — Pin the stack before producing evidence**

The geometry stack is in the evidence identity domain. Any planned image upgrade SHALL
happen **before** the first `SpatialEvidenceArtifact` is produced; upgrading afterwards
changes every subsequent identity and turns comparison into a migration problem.

---

## 10. Explicit forbidden actions under TV-4.3

- Running full raster processing pipelines inside PostgreSQL
- Registering out-db rasters keyed on file path instead of content digest
- Setting `postgis.gdal_enabled_drivers = ENABLE_ALL`
- Repairing geometry in place from a GIS client
- Identifying a processing model by label instead of graph hash
- Creating GIS-readable layers without declared SRID, typmod, or a single-column PK
- Letting GIS clients connect with a write-capable role
- Introducing GIS-vendor-specific dependencies into core

---

## 11. Definition of Done (TV-4.3)

| Criterion | Status |
| --- | --- |
| Raster source/derived split frozen | ✅ |
| Out-db digest keying frozen (SPC-R02) | ✅ |
| Driver allowlist requirement frozen (SPC-R03) | ✅ |
| Topology detection-not-repair frozen | ✅ |
| Model graph hashing frozen (SPC-R05) | ✅ |
| PostGIS exposure requirements frozen | ✅ |
| Capability neutrality frozen (SPC-R08) | ✅ |
| Engine baseline measured and recorded | ✅ |
| Driver allowlist applied to `postgresql.conf` | ❌ cold-start phase |
| Read-only GIS role created | ❌ cold-start phase (before tables) |
| Index values and partition tuning | ❌ TV-4 |

---

## Related

- [Roadmap — Capability Expansion](./ROADMAP-Capability-Expansion.md) (directional, not frozen)
- [TV-S1 — Spatial Verification Layer](./TV-S1-Spatial-Verification-Layer.md)
- [TV-3.0 — PostgreSQL Physical Data Strategy Freeze](./TV-3.0-PostgreSQL-Physical-Data-Strategy-Freeze.md)
- [ADR-MPS-CAS-STORAGE-BOUNDARY](./ADR-MPS-CAS-STORAGE-BOUNDARY.md)
- [postgis-prerequisites-checklist](../ops/postgis-prerequisites-checklist.md)
