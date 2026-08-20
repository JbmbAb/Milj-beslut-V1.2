# QGIS Plugin Foundation 01

## Scope

`integrations/qgis/mimer_read_model` is a PyQGIS plugin for spatial QA of
published Mimer read models. It consumes only a published map-layer catalog and
the `ReadModelFeatureCollectionV1` GeoJSON contract.

The initial pilots are:

- `property` via `postgis_property`
- `topo10-building` via `topo10_buildings`
- `protected-area` via `postgis_nvr`

## Boundary

The plugin resolves each pilot endpoint from `/api/reference/map-layers`,
requires that its published BBOX contract is well-formed, and then sends the
selected BBOX to the published endpoint. It validates `presentation_kind =
read_model`, the contract version, the expected layer identity, and every
`feature_ref` before creating a QGIS layer.

It must not query PostGIS, create or resolve canonical LU evidence, write CAS,
construct verdicts, or use `/api/spatial/evidence`. The canonical LU menu item
is intentionally registered as disabled and has no local unlock logic.

## Coordinate And Provenance Semantics

The backend read-model contract supplies GeoJSON in WGS84. The plugin carries
that geometry verbatim and performs no CRS guessing or frontend coordinate
conversion. It exports feature identity and provenance in each feature's
attributes. A source that does not provide immutable dataset version or
observation time remains `PARTIAL`; the export records those values as absent
rather than fabricating them.

## Proof Status

Pure-Python contract, catalog-resolution, export metadata, and boundary tests
are executable without QGIS:

```powershell
py -3.13 -m unittest discover -s integrations/qgis/mimer_read_model/tests -v
```

The real PyQGIS mount, GeoJSON/GeoPackage writer, and QGIS re-import proof are
environment-dependent and remain unverified until a QGIS 3.28+ runtime is
available. This is a delivery verification gap, not a fallback to another
spatial authority.
