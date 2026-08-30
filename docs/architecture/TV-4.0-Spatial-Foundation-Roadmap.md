# ADR-29: TV-4 Spatial Foundation Roadmap

## Status
Frozen (2026-08-08)

## Context
As the Mimer platform evolves to incorporate geographic and environmental intelligence (starting with LU v1.0), it is critical that spatial data handling (2D, 2.5D, and 3D) does not compromise the Frozen Core. 

A common anti-pattern is allowing geographic presentation layers (like QGIS or Cesium) to act as an alternate source of truth or Decision Authority. To prevent this, we are establishing a strict boundary where spatial tools consume and visualize spatial evidence but never determine architectural truth.

## The Constitutional Invariant

> **PostGIS computes spatial evidence. Cesium visualizes it. Blender produces advanced 3D assets. QGIS is the professional GIS tool.** 
> **None of these presentation/tool clients may ever act as the Decision Authority.**

## The Four Gates

Before progressing through the spatial phases, strict conditions (Gates) must be met to ensure architectural integrity.

### Gate A — Spatial Constitution
**Condition:** Must be fulfilled before any spatial engine is implemented.
- Requires: `SpatialQueryContract`, `SpatialEvidenceArtifact`, CRS-policy, spatial identity, authority boundary, determinism, and ownership rules.

### Gate B — PostGIS
**Condition:** Must be fulfilled before QGIS integration begins.
- Requires: Proven mapping of `query → spatial result → evidence`.
- Must demonstrate: PostGIS ≠ authority. PostGIS acts purely as a deterministic spatial engine.

### Gate C — 3D Runtime
**Condition:** Must be fulfilled before the Blender pipeline is established.
- Requires: Cesium 2D, Cesium 2.5D, spatial identity, height/reference system, 3D object semantics, and a 3D Tiles strategy.

### Gate D — 3D Production
**Condition:** Must be fulfilled before advanced 3D environmental modelling.
- Requires: Defined object model, asset identity, versioning, CRS/height conventions, import/export contracts, validation, and Cesium ingestion mechanisms.

---

## TV-4 Execution Phases

The execution of the spatial foundation will follow these exact phases in order.

### TV-4.0 Spatial Constitution
*Fulfilled by the creation of `SpatialQueryContract` and `SpatialEvidenceArtifact` (Commit 23.5).*
- `SpatialQueryContract`
- `SpatialEvidenceArtifact`
- CRS policy (SWEREF 99 TM / EPSG:3006)
- Spatial identity
- Authority boundary

### TV-4.1 PostGIS Spatial Engine
*The immediate next execution phase.*
- Providers
- Indexes
- Query execution
- Evidence production
- Observability

### TV-4.2 QGIS Integration
- Read model
- GIS inspection
- Data QA
- Controlled write surfaces

### TV-4.3 Cesium 2D
- Evidence visualization in 2D space.

### TV-4.4 Cesium 2.5D
- Height data, terrain, orthophotos, volumetric objects.

### TV-4.5 Cesium 3D / 3D Tiles
- Terrain, buildings, property objects, environmental objects, infrastructure.

### TV-4.6 Blender Production Pipeline
- Spatial extraction, QGIS/PostGIS to Blender import, 3D asset generation, validation.

### TV-4.7 Integrated 3D Environmental World
- Final orchestration of environmental modelling based on the strictly layered evidence chain.

## Consequences
By strictly enforcing these boundaries, the Mimer platform can seamlessly scale from simple 2D proximity checks (e.g., LU distance to water) to a fully realized 3D environmental twin without ever risking the integrity or epistemic separation of the Frozen Core.
