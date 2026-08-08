# ADR — PostGIS Admit v1 Gate

## Status

**FROZEN** — Admit v1 set + layer_id contracts recorded.

- Set: [admit-v1/ADMIT-V1-SET.md](./admit-v1/ADMIT-V1-SET.md)  
- Contracts: [admit-v1/LAYER-ID-CONTRACTS-V1.md](./admit-v1/LAYER-ID-CONTRACTS-V1.md)  
- SHA ledger: [admit-v1/master-walk-pass2-sha-ledger.json](./admit-v1/master-walk-pass2-sha-ledger.json)

Empty / sanitized PostGIS is the **next HITL ops step** (not auto-start).  
Not L3. Not LU broadening on the old DB.

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

**Decided:** NV `ADMIT` into `env.water_protection_area`; LST / `VISS/lst_vattenskydd` `OUT_OF_SCOPE` v1.  
Do **not** dual-load. Do **not** substitute `lu.topo_water` (BLOCKED) for water protection.

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

## Candidate ledger (decided — see ADMIT-V1-SET)

| layer_id (proposed) | Need | Candidate source_id | admit_status | Notes |
|---|---|---|---|---|
| `lu.property_unit` | Fastighet | LM registerytor → property_unit | **ADMIT** | Foundation; MM prerequisite |
| `lu.water_wells` | Brunnar | SGU → `sgu_well` | **ADMIT** | Magic Moment |
| `lu.ebh` | EBH | LST → `ebh_potentiellt_fororenade_omraden` | **ADMIT** | Magic Moment |
| `lu.protected_area` | Skyddad natur | NV → `protected_area` | **ADMIT** | Magic Moment |
| `lu.natura2000` | Natura 2000 | NV SPA rikstäckande → `natura2000_area` | **ADMIT** | SCI = later wave |
| `lu.water_protection` | Vattenskydd | **NV** (LST OOS) | **ADMIT** | Sole authority NV |
| `lu.flood_risk` | Översvämning | MSB → `flood_risk_area` | **ADMIT** | Breadth |
| `lu.soil_type` | Jordarter | SGU → `sgu_soil_type_25k_100k` | **ADMIT** | Breadth |
| `lu.landslide` | Skred | SGU → `sgu_landslide_feature` | **ADMIT** | Breadth |
| `lu.viss_waterbody` | Avrinningsområde | SMHI SVAR → `water_catchment` | **ADMIT** | Authority SMHI, not live VISS |
| `lu.sks_nature` | Nyckelbiotoper | SKS → `sks_nyckelbiotoper` | **ADMIT** | Breadth |
| `lu.topo_water` | Topo vatten | LM Topografi50 hydrografi | **BLOCKED** | No IMPORT_REGISTRY |
| `lu.raa_culture` | Kulturmiljö | RAA lämningar GPKG | **OUT_OF_SCOPE** v1 | SHA retained |
| — | LST / `VISS/lst_vattenskydd` | — | **OUT_OF_SCOPE** | XOR loser |
| — | FAPI servitut | — | **OUT_OF_SCOPE** | Parked / missing |
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

## Explicitly not next (until HITL rebuild ops)

- Auto-start empty PostGIS without operator confirm  
- Import of NV+LST vattenskydd  
- L3 rechunk  
- LU registry expansion on the old DB  
- Blind GiST / performance work  
- Re-hash of Pass 2 bindings  

## Work after this ADR

1. ~~Master walk Pass 1 (metadata)~~ → [admit-v1/MASTER-WALK-PASS1.md](./admit-v1/MASTER-WALK-PASS1.md) (`957f38492c05b159`)  
2. ~~Pass 2 SHA~~ → [admit-v1/MASTER-WALK-PASS2.md](./admit-v1/MASTER-WALK-PASS2.md)  
3. ~~Vattenskydd NV xor LST~~ → NV ADMIT / LST OUT_OF_SCOPE  
4. ~~RAÄ~~ → OUT_OF_SCOPE v1  
5. ~~Freeze Admit v1 + layer_id contracts~~ → [ADMIT-V1-SET.md](./admit-v1/ADMIT-V1-SET.md)  
6. **Next (HITL):** sanitize → empty PostGIS → import ADMIT only → Magic Moment acceptance on new DB.  

