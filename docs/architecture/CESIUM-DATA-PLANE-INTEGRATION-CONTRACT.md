# Cesium ↔ Data-plane integration contract (TV-4 map front)

**Status:** ACCEPTED for presentation seam (CESIUM-TV4-MAPFRONT-CLOSE-PARALLEL-01)  
**Authority:** Cesium is NEVER Decision Authority. PostGIS computes spatial evidence; Cesium visualizes.

## Invariant

```text
GEO_Master_Archive / governed PostGIS
  → SpatialQueryContract / read-model presentation products
  → Map/3D API (bounded)
  → Cesium (pure visualizer)
```

Cesium must not invent property identity, risk, distance truth, dataset authority, or LU results.

## Layer products Cesium is ready to receive

| Layer | Presentation | Client status | Expected governed product |
|---|---|---|---|
| PROPERTY | Viewport GeoJSON (map-viewport-v1) then national 3D Tiles | READY | Bounded property presentation from `core.property_unit` read-model / future tiles |
| BUILDINGS | 3D Tiles | BUILDING CLIENT COMPLETE / REAL NATIONAL DATA PENDING | Governed buildings tileset URL + provenance |
| TERRAIN | Terrain tiles / ellipsoid fallback | READY (ellipsoid + fixture seam) | Governed DEM tiles + vertical CRS decision |
| ORTHOPHOTO | Imagery tiles | READY (local fixture seam) | Local/governed tile endpoint + dataset_id + attribution |
| LAND COVER | Registration seam only | SEAM_ONLY | Presentation registration when product exists |
| TOPOGRAPHY | Registration seam only | SEAM_ONLY | Presentation registration when product exists |
| HYDROGRAPHY | Registration seam only | SEAM_ONLY | Existing `/api/layers/hydro.*` may later feed a presentation product |

## Height / CRS

- Horizontal presentation CRS for Cesium: WGS84 / EPSG:4326 (server transforms from SWEREF99 TM / EPSG:3006).
- Vertical: `cesium.height-reference.v0` — `ELLIPSOID_WGS84_PRESENTATION_ONLY` until owner decision admits RH2000/geoid.

## Endpoints this branch consumes

- `GET /api/map/presentation/viewport` — property viewport (live or explicit fixture)
- `GET /api/map/presentation/registry` — presentation config
- `GET /api/spatial/evidence` — exploration evidence (not LU product authority)
- Localization geometry routes — server remains geometry/CRS authority
- Static local fixtures under `/cesium/fixtures/**`

## Explicit non-goals on this branch

- No Loke / Dataportalen / Geodataportalen / LM registry / ADMIT-V1 / Master-CAS / DatasetApproval / PostGIS schema ownership / ingestion changes.
- No fake production proofs against national governed data that is not present.
