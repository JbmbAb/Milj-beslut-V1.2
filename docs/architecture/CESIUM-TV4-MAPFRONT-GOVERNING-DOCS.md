# Governing documents for Cesium TV-4 map front (this branch)

## Authority boundary

- `docs/architecture/TV-4.0-Spatial-Foundation-Roadmap.md`
- `docs/architecture/ADR-SPATIAL-PRESENTATION-EVIDENCE-CONTRACT.md`
- `docs/architecture/SPATIAL-SCHEMA-OWNERSHIP-01.md` (schema ownership — Cesium does not own DDL)

Invariant: PostGIS computes spatial evidence; Cesium visualizes; Cesium is NEVER Decision Authority.

## CRS

- Horizontal: SWEREF99 TM / EPSG:3006 in spatial engine; WGS84 / EPSG:4326 for Cesium presentation.
- Index-preserving transform of search window into native CRS (presentation ADR §4).

## Height / reference

- `docs/architecture/ADR-CESIUM-HEIGHT-REFERENCE-CONTRACT.md`
- Code: `components/cesium/heightReferenceContract.ts` (`ELLIPSOID_WGS84_PRESENTATION_ONLY`, owner UNDECIDED)

## SpatialQueryContract / SpatialEvidenceArtifact

- `docs/architecture/ADR-SPATIAL-QUERY-CONTRACT.md`
- `packages/mps-lu/src/services/SpatialQueryContract.ts`
- `packages/mps-lu/src/artifacts/SpatialEvidenceArtifact.ts`
- Presentation adapter: `server/services/geoPresentationAdapter.ts` + `geoPresentationContract.ts`

## Presentation identity

- Property identity ≠ geometry (`ADR-SPATIAL-PRESENTATION-EVIDENCE-CONTRACT` §3)
- Client: `components/cesium/propertySelection.ts`
- Server read-model: `getPropertyLayer` / map-viewport-v1

## Localization drawing

- Server authority: `server/modules/localization/localizationGeometryService.ts`
- Routes: `server/routes/localization.routes.ts`
- Proof: `scripts/ops/prove-lu-cesium-localization-drawing-01.ts`
- Client draw/pick: `CesiumAdapter` location picking + `CesiumMapView` props

## Property rendering / 3D strategy

- 2D/2.5D entities + search radius ring
- National property/buildings → 3D Tiles (presentation ADR table)
- Client tileset: `components/cesium/tilesetClient.ts` + local fixture
- Integration seam: `docs/architecture/CESIUM-DATA-PLANE-INTEGRATION-CONTRACT.md`
