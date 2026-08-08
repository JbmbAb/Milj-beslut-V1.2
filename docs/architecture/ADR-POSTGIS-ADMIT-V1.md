# ADR — PostGIS Admit v1 Gate

## Status

**ACTIVE GATE** — next work after rebuild-contract freeze (`6377feb`).

Empty PostGIS remains **BLOCKED** until Admit v1 is frozen.  
Not L3. Not LU broadening. Not import.

Parent sequence: [ADR-POSTGIS-REBUILD-DATA-CONTRACT.md](./ADR-POSTGIS-REBUILD-DATA-CONTRACT.md)  
Inventory: [MASTER-SPATIAL-SOURCE-INVENTORY.md](./MASTER-SPATIAL-SOURCE-INVENTORY.md)

## Rule

No source enters the new PostGIS merely because it exists under `GEO_Master_Archive`.

Every candidate needs an **explicit, verifiable admit decision**.

## Decision model (per candidate)

```text
MASTER SOURCE
     │
     ├── authority
     ├── format
     ├── source path
     ├── source version/date
     ├── SHA-256                    ← source identity
     ├── geometry / SRID
     ├── layer_id
     └── admit_status
              │
              ├── ADMIT
              ├── OUT_OF_SCOPE
              └── BLOCKED
```

| Field | Meaning |
|---|---|
| `authority` | Owning provider / SoT org (LM, SGU, NV, LST, …) |
| `format` | Archive payload format (GPKG, SHP, ZIP, …) |
| `source_path` | Path under `GEO_Master_Archive/Data/…` |
| `source_version` / date | Provider or harvest version label |
| `source_sha256` | Content hash of the **master file/bundle** |
| `geometry` / `srid` | Expected geometry family; LU target SRID **3006** |
| `layer_id` | Stable logical id for SpatialLayerRegistry / contract |
| `admit_status` | `ADMIT` \| `OUT_OF_SCOPE` \| `BLOCKED` |

### Identity chain (required for ADMIT)

```text
source_sha256
      ↓
import manifest
      ↓
dataset / version hash
      ↓
PostGIS layer (projection)
```

- **Source identity** = which master bytes were admitted (`source_sha256` + path + version).  
- **Imported dataset identity** = materialization hash recorded at import (`version_hash` / dataset hash).  
Later proofs: *this PostGIS layer came from that exact master file*.

`ADMIT` without both identities is invalid.

## Authority decisions that must be explicit

### Vattenskydd — one admitted source only

```text
NV ─────┐
        ├──→ authority decision → ONE admitted source
LST ────┘
```

Do **not** import both NV and LST into `water_protection_area` (or dual tables) until this decision is recorded as `ADMIT` for exactly one `source_id` and `OUT_OF_SCOPE` / `BLOCKED` for the other.

### RAÄ / kulturmiljö

```text
RAÄ
 │
 ├── registry + manifest → ADMIT
 │
 └── explicit decision    → OUT_OF_SCOPE v1
```

No implicit legacy inflow from old PostGIS or live RAA API.

## Admit statuses

| Status | Meaning | May enter new PostGIS? |
|---|---|---|
| `ADMIT` | Authority + path + SHA + layer_id + identity chain complete | Yes (import order per contract) |
| `OUT_OF_SCOPE` | Consciously excluded from v1 | No |
| `BLOCKED` | Missing registry, manifest, SHA, or unresolved authority conflict | No |

## Candidate ledger (pending decisions)

Fill SHA/path/version from master walk. Until filled + decided, status stays `BLOCKED` or undecided.

| layer_id (proposed) | Need | Candidate source_id | admit_status | Notes |
|---|---|---|---|---|
| `lu.property_unit` | Fastighet | LM registerytor → property_unit | **pending** | Foundation; MM prerequisite |
| `lu.water_wells` | Brunnar | SGU → `sgu_well` | **pending** | Magic Moment |
| `lu.ebh` | EBH | LST → `ebh_potentiellt_fororenade_omraden` | **pending** | Magic Moment |
| `lu.protected_area` | Skyddad natur | NV → `protected_area` | **pending** | Magic Moment |
| `lu.natura2000` | Natura 2000 | NV → `natura2000_area` | **pending** | Breadth candidate |
| `lu.water_protection` | Vattenskydd | NV **xor** LST | **BLOCKED** | Dual authority — decide ONE |
| `lu.flood_risk` | Översvämning | MSB → `flood_risk_area` | **pending** | Breadth candidate |
| `lu.soil_type` | Jordarter | SGU → `sgu_soil_type_25k_100k` | **pending** | Breadth candidate |
| `lu.landslide` | Skred | SGU → `sgu_landslide_feature` | **pending** | Breadth candidate |
| `lu.viss_waterbody` | VISS | VISS harvest | **pending** | Breadth candidate |
| `lu.topo_water` | Topo vatten | LM topo10.vatten | **pending** | Foundation / distance |
| `lu.raa_*` | Kulturmiljö | RAA master | **BLOCKED** | Registry+manifest **or** OUT_OF_SCOPE v1 |
| — | FAPI servitut | — | **OUT_OF_SCOPE** (proposed) | Parked / missing |
| — | Live API / Millbygård paths | — | **OUT_OF_SCOPE** | No auto-carry |

## Freeze criteria for Admit v1

Admit v1 is **FROZEN** only when:

1. Every Magic Moment layer + property foundation has `ADMIT` with `source_sha256` + import-manifest binding.  
2. Vattenskydd has exactly one `ADMIT` source (or explicit `OUT_OF_SCOPE` for the whole need in v1).  
3. RAÄ has either `ADMIT` (registry+manifest) or explicit `OUT_OF_SCOPE v1`.  
4. No candidate remains “implicitly included.”  
5. `layer_id` contract rows exist for every `ADMIT` entry (fields from rebuild ADR).

Then — and only then:

```text
Admit v1 🔒
   ↓
layer_id contract 🔒
   ↓
empty PostGIS
   ↓
imports
   ↓
validation
   ↓
Magic Moment acceptance (new DB)
```

## Explicitly not next

- Empty / sanitized PostGIS install  
- Import of NV+LST vattenskydd  
- L3 rechunk  
- LU registry expansion on the old DB  
- Blind GiST / performance work  

## Work after this ADR

1. ~~Master walk Pass 1 (metadata)~~ → [admit-v1/MASTER-WALK-PASS1.md](./admit-v1/MASTER-WALK-PASS1.md) (`957f38492c05b159`)  
2. Pass 2: stream SHA-256 + geometry/SRID **only** for classified Admit v1 candidates (not full archive).  
3. Decide vattenskydd authority (NV xor LST) — Pass 1 found NV VSO in archive; no LST vattenskydd path.  
4. Decide RAÄ: ADMIT vs OUT_OF_SCOPE v1.  
5. Freeze Admit v1 ledger + layer_id contracts.  
