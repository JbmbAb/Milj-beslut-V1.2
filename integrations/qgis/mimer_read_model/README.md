# Mimer QGIS read-model plugin

This plugin is a spatial exploration and QA client. It consumes only Mimer
read-model GeoJSON responses that declare `presentation_kind: read_model` and
the V1 feature-identity contract.

It does not provide canonical LU assessment presentation. That UI is registered
as locked until the separately governed viewer capability and presentation
boundary exist.

Exports carry Mimer identity and provenance attributes in every feature so a
GeoPackage or GeoJSON remains self-describing without a required sidecar.

Run pure-Python proofs without QGIS:

```powershell
py -3.13 -m unittest discover -s integrations/qgis/mimer_read_model/tests -v
```
