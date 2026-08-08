# Master Spatial Source Inventory (SoT)

**Status:** DRAFT — step 1–2 of PostGIS rebuild sequence  
**Authority:** `GEO_Master_Archive` + `IMPORT_REGISTRY`  
**Not authority:** current PostGIS table counts / legacy `env.*` clutter  

Cross-ref: [ADR-POSTGIS-REBUILD-DATA-CONTRACT.md](./ADR-POSTGIS-REBUILD-DATA-CONTRACT.md)

Master root observed mounted: `H:\Delade enheter\Miljöbeslut\GEO_Master_Archive\Data\`  
Provider folders present: `Lantmateriet`, `LM`, `SGU`, `Naturvardsverket`, `LST`, `MSB`, `VISS`, `SMHI`, `Skogsstyrelsen`, `RAA`, `SMED`, `MCF`, `Trafikverket`, …

## Status key

| Field | Values |
|---|---|
| **Authority** | `MASTER` = may admit · `LIVE_ONLY` = discovery/viz only · `LEGACY` = must not auto-carry · `MISSING` = no master/registry mapping |
| **LU value** | `critical` / `high` / `medium` / `low` for lokaliseringsutredning |
| **Admit v1** | Whether this source is a candidate for the **first** sanerad PostGIS + LU breadth (decision pending freeze of admit-set) |

---

## LU-oriented inventory

| Källa (need) | Master provider / path key | Format | Geometry | Update / harvest | Provenance | Authority | LU-värde | Admit v1 |
|---|---|---|---|---|---|---|---|---|
| Fastighetsdata (ytor) | `Lantmateriet/Fastighetsindelning*_Nationell/Registerenhetsomradesytor` → sync `core.property_unit` | GPKG (STAC merge) | MultiPolygon | STAC / Librarian | LM + SHA manifest | MASTER | critical | **yes** |
| Fastighetslinjer | `Lantmateriet/.../Registerenhetsomradeslinjer` | GPKG | Line | STAC | LM | MASTER | medium | optional |
| Brunnsdata (Magic Moment `water`) | `SGU` → `env.sgu_well` (`Brunnar` / platform `sgu_wells`) | GPKG / OAPIF harvest | Point | SGU open data | SGU + SHA | MASTER | critical | **yes** (MM) |
| EBH | `LST/EBH_Potentiellt_fororenade_omraden` | GPKG/ZIP | Polygon | LST distribution ZIP | LST + SHA | MASTER | critical | **yes** (MM) |
| Skyddad natur / NVR | `Naturvardsverket/SkyddadeOmraden/Naturreservat` → `protected_area` | SHP | MultiPolygon | NV harvest | NV + SHA | MASTER | critical | **yes** (MM) |
| Natura 2000 | `Naturvardsverket/Natura2000/Omrade` | SHP | MultiPolygon | NV harvest | NV + SHA | MASTER | high | candidate |
| Vattenskydd (NV) | `Naturvardsverket/Vatten/Vattenskyddsomrade` | SHP | MultiPolygon | NV harvest | NV + SHA | MASTER | high | candidate |
| Vattenskydd (LST alt.) | `VISS/lst_vattenskydd` → same target table | GPKG | MultiPolygon | LST/VISS path | LST | MASTER* | high | resolve conflict |
| Översvämning | `MSB/oversvamning_nationell` / `FloodRisk` → `climate.flood_risk_area` | GPKG | Polygon | MSB INSPIRE | MSB + SHA | MASTER | high | candidate |
| Jordarter 25k–100k | `SGU` → `sgu_soil_type_25k_100k` | GPKG | MultiPolygon | SGU | SGU + SHA | MASTER | high | candidate |
| Jordskred / raviner | `SGU` → `sgu_landslide_feature` | GPKG | Geometry | SGU | SGU + SHA | MASTER | high | candidate |
| Fastmark / stabilitet | `SGU` → `sgu_fastmark_stabilitet` | GPKG | MultiPolygon | SGU | SGU + SHA | MASTER | medium | later |
| Grundvattenmagasin / sårbarhet | `SGU` → `env_sgu_grundvatten_sarbarhet` / magasinslager | GPKG | Polygon | SGU | SGU + SHA | MASTER | medium | later |
| VISS vattenförekomster | `VISS/viss_vattenforekomster` (+ `viss.*` schemas) | GPKG | Polygon | LST WFS harvest→master | VISS + SHA | MASTER | high | candidate |
| Topo vatten (avstånd) | `Lantmateriet` topo / `topo10.vatten` | GPKG | Polygon | STAC/topo | LM | MASTER | high | foundation |
| SKS nyckelbiotoper | `Skogsstyrelsen/SksNyckelbiotoper` | GPKG | Polygon | SKS feed→master | SKS + SHA | MASTER | medium | later |
| Kulturmiljö / fornlämning | Master folder `RAA/` exists | ? | ? | harvest incomplete vs registry | RAA | **MISSING in IMPORT_REGISTRY** | high | **block until registry+manifest** |
| Byggnadsminnen / kulturmiljöområden | Present historically in old PostGIS | ? | ? | often archive fill | — | LEGACY until master key frozen | medium | no auto-carry |
| SLU artobservationer | Live WFS / platform collection often disabled | — | Point | live | SLU | LIVE_ONLY | medium | not v1 PostGIS |
| FAPI servitut | — | — | — | — | — | MISSING | medium | parked |
| LM Hydrografi Direkt | — | — | — | — | — | MISSING / parked | low | parked (topo substitute) |
| Millbygård local GPKG paths in platform-datasources | Local filePath under `C:\Millbygard_...` | GPKG | various | manual | — | **LEGACY** | — | **must not auto-carry** |
| Disabled PLATFORM_COLLECTIONS live endpoints | Various | — | — | live fail | — | LIVE_ONLY | — | harvest to master first |

\* If both NV and LST map to `water_protection_area`, the **admit contract** must pick one `source_id` + promote strategy before import.

---

## Magic Moment acceptance set (minimum)

These three **must** be contracted and importable before Magic Moment re-proof on sanerad PostGIS:

| layer_id (proposed) | source_id (IMPORT_REGISTRY) | target |
|---|---|---|
| `lu.water_wells` | SGU brunnar → `sgu_well` | `env.sgu_well` |
| `lu.ebh` | `LST/EBH_Potentiellt_fororenade_omraden` | `env.ebh_potentiellt_fororenade_omraden` |
| `lu.protected_area` | `Naturvardsverket/SkyddadeOmraden/Naturreservat` | `env.protected_area` |

Plus property foundation: LM registerytor → `core.property_unit`.

---

## Explicit non-carry list (into new PostGIS)

- Any `env.*` / `climate.*` / `topo*` table that lacks a master path + IMPORT_REGISTRY entry  
- Tables filled only via live API usecase paths (NVR/RAA/VISS/SLU) without archive harvest  
- Ad-hoc seed fixtures from `riskguard_test` (test DB only)  
- `_migration_from_D` / experimental folders as production layers  
- Duplicate conflicting targets without a chosen `source_id`

---

## Next freeze steps (still no empty PostGIS)

Active gate document: [ADR-POSTGIS-ADMIT-V1.md](./ADR-POSTGIS-ADMIT-V1.md)

1. Walk master `Data/<Provider>` — fill `source_path` / version / `source_sha256` per candidate  
2. Vattenskydd: **one** authority (NV xor LST) — never both until decided  
3. RAÄ: registry+manifest → `ADMIT` **or** explicit `OUT_OF_SCOPE v1`  
4. Freeze Admit v1 ledger + `layer_id` contracts (source identity ≠ imported dataset identity)  
5. Only then: dump HITL → sanitize → cold empty PostGIS → import  

## Do not

- Rebuild PostGIS before contract freeze  
- Copy old PostGIS “for safety”  
- Start L3 / cache / blind indexes  
- Treat `data-coverage-gaps.md` counts as admit authority  
