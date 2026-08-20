# QGIS-READ-MODEL-FEATURE-IDENTITY-CONTRACT-01

**Status:** IMPLEMENTED / PROVEN AT CONTRACT LEVEL.

## Contract

`ReadModelFeatureIdentityV1` is client-neutral. It is emitted as the GeoJSON
feature `id` and as `properties.feature_identity` / `properties.feature_ref` on
the pilot read-model outputs.

```text
layer_id
identity_kind = SOURCE | DERIVED
identity_version = read-model-feature-identity-v1
source_namespace + source_feature_id | derived_feature_id
feature_ref
```

`feature_ref` is deterministic and source-namespaced. It never depends on row
order, an auto-increment key, import order, or a presentation client.

## Pilot rules

- **Property:** ordinary records use `source_dataset + source_key`. Merged
  records use `property-merge-v1`, a SHA-256 identity over their sorted source
  `objektidentitet` components. Missing components produce no feature identity.
- **Building:** `topo10.byggnad.objektidentitet` is namespaced as
  `topo10.byggnad`. Empty ids fail closed. Its producer reload stability remains
  a data proof required before export coverage is declared proven.
- **Protected area:** `NVR:nvr_id` and `Natura2000:external_id` are represented
  through the route's explicit `source + nvr_id` pair.

## Proof

- Same source inputs yield the same `feature_ref`.
- Equal local ids in different producer namespaces yield different refs.
- Merged component order does not change a ref; changed components do.
- Empty source components fail closed.
- The property, building, and protected-area responses emit the contract.

## Scope boundary

This is a spatial read-model contract only. It does not create canonical LU
evidence, assessments, CAS state, or a QGIS plugin. `/api/spatial/evidence`
remains forbidden to QGIS.
