# Mimer QGIS read-model plugin

This plugin is a spatial exploration and QA client. It consumes only Mimer
read-model GeoJSON responses that declare `presentation_kind: read_model` and
the V1 feature-identity contract.

It initially exposes eleven catalog-backed layers: the three foundation pilots,
Natura 2000, international and water protection, four exact SGU source layers,
and Topo10 streams. See `docs/architecture/QGIS-PLUGIN-FOUNDATION-BREADTH-01.md`
for the explicit coverage matrix and excluded layers.

It does not provide canonical LU assessment presentation. That UI is registered
as locked until the separately governed viewer capability and presentation
boundary exist.

Exports carry Mimer identity and provenance attributes in every feature so a
GeoPackage or GeoJSON remains self-describing without a required sidecar.

Run pure-Python proofs without QGIS:

```powershell
py -3.13 -m unittest discover -s integrations/qgis/mimer_read_model/tests -v
```
