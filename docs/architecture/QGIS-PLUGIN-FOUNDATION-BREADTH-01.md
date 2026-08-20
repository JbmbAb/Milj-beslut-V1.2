# QGIS Plugin Foundation Breadth 01

## Eligibility Gate

A catalog layer is `READY_FOR_QGIS` only when its existing BBOX route emits a
`ReadModelFeatureCollectionV1` response with a stable source-bound
`feature_ref`, plus explicit provenance status. QGIS consumes only that
published representation.

## Coverage Matrix

| Catalog family | Status | Identity basis | Notes |
| --- | --- | --- | --- |
| property | READY_FOR_QGIS | LM source identity or versioned merge recipe | Foundation pilot |
| Topo10 building | READY_FOR_QGIS | `topo10.byggnad.objektidentitet` | Foundation pilot |
| protected nature | READY_FOR_QGIS | `NVR:nvr_id` | Foundation pilot |
| Natura 2000 | READY_FOR_QGIS | `natura2000_area.external_id` | Breadth |
| international protection | READY_FOR_QGIS | `protected_area.nvr_id` | Breadth |
| water protection | READY_FOR_QGIS | water-protection id or NVR fallback id | Breadth; identity namespace records branch |
| SGU wells | READY_FOR_QGIS | `brunnsid` | Breadth |
| SGU permeability | READY_FOR_QGIS | `objectid` | Breadth |
| SGU groundwater magazines | READY_FOR_QGIS | producer magazine identity | Breadth |
| SGU groundwater bodies | READY_FOR_QGIS | `ms_cd`, with `eu_cd` fallback | Breadth |
| Topo10 streams | READY_FOR_QGIS | `topo10.vatten.objektidentitet` | Breadth |
| SGU soil / ground layers | IDENTITY_RECON_REQUIRED | local `ogc_fid` | Import-order stability not proven |
| SGU landslide / coastal / coastline | IDENTITY_RECON_REQUIRED | source identifier not frozen | No QGIS admission |
| VISS lakes | PROVENANCE_GAP | multiple table branches | Source/version semantics need freeze |
| generic dataset endpoints | ENDPOINT_GAP | varies by dataset | Do not imply one identity contract |
| external LST/RAA WFS | NOT_SUITABLE | external acquisition surface | Not a local read-model contract |

## Boundary

This unit introduces no direct PostGIS client access, canonical evidence,
assessment, CAS, or verdict capability. All new layers remain `PARTIAL` until
the server read model supplies stronger immutable dataset provenance.
