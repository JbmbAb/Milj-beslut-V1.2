# QGIS-FEATURE-IDENTITY-RECON-01

**Status:** CLOSED / ESTABLISHED / READ-ONLY.

**Decision:** `QGIS-PLUGIN-FOUNDATION-01` remains blocked. None of the three
candidate pilot endpoints currently provides a fully proven, uniform stable feature
identity suitable for the foundation export contract.

This recon made no runtime, schema, API, plugin, staging, or data changes.

## Boundary retained

The examined endpoints are spatial read models only:

```text
/api/geodata/* and /api/layers/*
  -> spatial exploration and QA
  -> never canonical LU evidence or assessment authority

/api/spatial/evidence
  -> forbidden to QGIS
```

In particular, this recon did not promote a database primary key, a GeoJSON array
position, or a QGIS-generated id into an authority-bearing identity.

## Common finding

Neither `getPropertyLayer`, `getProtectedAreaLayer`, nor `getTopo10Layer` emits a
GeoJSON top-level `Feature.id`. Identifiers appear only inside `properties`, and
the endpoint contracts do not expose a common `feature_id`, source namespace, or
dataset version. Therefore a QGIS client cannot yet receive the frozen
`ReadModelFeatureCollectionV1` identity/provenance shape from
`QGIS-PLUGIN-FOUNDATION-ARCH-DECISION-01`.

## Pilot-layer map

| Candidate | Current route and value | Origin | Reload stability | Disposition |
| --- | --- | --- | --- | --- |
| Property | `/api/layers/property`; `properties.sourceKey` | `core.property_unit.source_key` | Mixed. Individual rows derive it from Lantmäteriet `objektidentitet`; merged rows use derived `merged:<designation_norm>`. The route does not expose `source_dataset` to distinguish them. | **BLOCKED** |
| Building | `/api/geodata/topo-buildings`; `properties.id` | `topo10.byggnad.objektidentitet` | Source-looking field, but no non-null/unique constraint or import/reload proof is established. `layerConfig.ts` simultaneously declares internal `fid` as the id column, which confirms that semantics are not frozen. | **BLOCKED** |
| Protected area | `/api/geodata/protected-nature` and `/api/layers/nvr`; `properties.nvr_id` plus `properties.source` | `env.protected_area.nvr_id` for NVR, `env.natura2000_area.external_id` aliased as `nvr_id` for Natura 2000 | Both underlying ids are source-derived and primary keys in their respective tables. The union endpoint needs the source namespace to avoid treating two producer domains as one id space. Live uniqueness and reload comparison remain unexecuted. | **CONDITIONALLY CANDIDATE** |

## Evidence

### Property

`server/services/propertyUnitService.ts` returns only `sourceKey` and
`designation` from `core.property_unit`. The normal materializer derives
individual keys from `env.registerenhetsomradesytor.objektidentitet`
(`scripts/db/sync-property-unit-from-env.ts`), but the same materializer produces
merged rows with `merged:<designation_norm>`. The latter is a presentation/model
derivation, not a source feature identifier.

The safe current conclusion is not to use `sourceKey` as a generic QGIS
`feature_id`. A future contract must either exclude merged property records from
feature-addressable export or carry an explicit identity kind and source dataset.

### Building

`server/services/publicUiService.ts` selects `objektidentitet AS id` from
`topo10.byggnad`. This is preferable to the internal serial `id` in test DDL, but
the repository does not establish its uniqueness or stability across a real
Topo10 reload. `server/modules/gis/layerConfig.ts` names `fid` as its id column,
which is an incompatible internal-id convention. No candidate is promoted until
one canonical source-feature field is selected and evidenced against reload.

### Protected area

`env.protected_area.nvr_id` and `env.natura2000_area.external_id` are primary
keys. The importer maps NVR ids from the producer's `NVRID`/equivalent field and
Natura 2000 ids from `SITE_CODE`. The read-model union preserves a source tag
(`NVR` or `Natura2000`) but aliases both values as `nvr_id`.

The only admissible candidate representation is therefore namespaced:

```text
feature_ref = layer_id + ":" + properties.source + ":" + properties.nvr_id
```

This is still conditional until a read-only live check establishes non-nullness
and uniqueness of the emitted `(source, nvr_id)` pairs and a reload comparison
shows that producer ids persist.

## Required follow-up before plugin foundation

Open a small contract unit, not plugin implementation:

```text
QGIS-READ-MODEL-FEATURE-IDENTITY-CONTRACT-01
```

It must:

1. Define an explicit source-namespaced feature reference in the read-model DTO.
2. Include the producing dataset/version and provenance needed for export.
3. Resolve the property merged-record policy.
4. Choose and prove the canonical Topo10 building identifier against a real
   reload.
5. Run read-only uniqueness and reload checks for the protected-area union.

Only after that contract is proven can `QGIS-PLUGIN-FOUNDATION-01` start with
property, building, and protected-area layers. It must still consume only the
read-model endpoints and must not use `/api/spatial/evidence`.
