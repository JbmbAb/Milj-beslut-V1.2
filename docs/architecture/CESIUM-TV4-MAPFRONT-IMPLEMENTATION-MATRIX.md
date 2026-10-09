# CESIUM IMPLEMENTATION MATRIX — TV-4 map front close

Branch: `rt/cesium-tv4-close-01`  
Base: `877093ac` / tree `d6128386`

| Area | Status |
|---|---|
| BOOT | IMPLEMENTED |
| LOCAL ASSETS | IMPLEMENTED |
| CAMERA | IMPLEMENTED |
| CRS | IMPLEMENTED (WGS84 presentation; SWEREF99 TM server-side) |
| PROPERTY GEOMETRY | IMPLEMENTED |
| PROPERTY IDENTITY | IMPLEMENTED (≠ geometry) |
| PROPERTY SELECTION | IMPLEMENTED |
| SPATIAL EVIDENCE | IMPLEMENTED (live + explicit fixture) |
| EVIDENCE DETAILS | IMPLEMENTED |
| BUFFER/QUERY GEOMETRY | PARTIAL (search radius ring; query authority remains server) |
| LOCALIZATION DRAW/SAVE/RELOAD | IMPLEMENTED (server authority) |
| LIVE/FIXTURE MODE | IMPLEMENTED (default LIVE; fixture explicit) |
| VIEWPORT LOADING | IMPLEMENTED |
| REQUEST CANCELLATION | IMPLEMENTED |
| CACHE | PARTIAL (stale abort / latest-wins; no long-lived feature cache) |
| LOD | PARTIAL (viewport span cap + feature limit; national LOD via future 3D Tiles) |
| 3D TILES | IMPLEMENTED (client + local fixture) |
| BUILDINGS | IMPLEMENTED client / BLOCKED_BY_GOVERNED_DATA for national |
| TERRAIN | IMPLEMENTED seam (ellipsoid + fixture) / BLOCKED_BY_GOVERNED_DATA national |
| HEIGHT | BLOCKED_BY_DECISION (explicit ellipsoid-only contract) |
| ORTHOPHOTO | IMPLEMENTED seam + local fixture / BLOCKED_BY_GOVERNED_DATA national |
| LAND COVER | IMPLEMENTED registration seam only |
| TOPOGRAPHY | IMPLEMENTED registration seam only |
| HYDROGRAPHY | IMPLEMENTED registration seam only |
| ERROR STATES | IMPLEMENTED |
| OFFLINE/LOCAL-FIRST | IMPLEMENTED |
| WEBGL BROWSER TEST | IMPLEMENTED harness |
| PERFORMANCE TEST | PARTIAL (lifecycle guards + cancel; focused rapid interaction checks) |
