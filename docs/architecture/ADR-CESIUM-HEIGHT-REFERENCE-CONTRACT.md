# ADR — Cesium height / vertical reference contract

## Status

**ACCEPTED AS UNDECIDED SEAM** (2026-10-09, CESIUM-TV4-MAPFRONT-CLOSE-PARALLEL-01)

## Decision

Do **not** invent a national vertical CRS / geoid binding for Cesium presentation.

Until an owner decision admits:

- vertical CRS (e.g. RH2000),
- geoid / height transformation model,
- terrain product provenance,

the Cesium map front uses only:

```text
contract_id: cesium.height-reference.v0
mode: ELLIPSOID_WGS84_PRESENTATION_ONLY
owner_decision: UNDECIDED
```

## Consequences

- Terrain seam defaults to ellipsoid; local fixture mode is provenance-marked only.
- Extruded evidence volumes and markers use ellipsoid heights as presentation aids, not survey truth.
- Governed 3D products must carry explicit height metadata before Cesium may claim orthometric heights.
