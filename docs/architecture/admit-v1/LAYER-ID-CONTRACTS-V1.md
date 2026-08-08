# Layer ID Contracts — Admit v1

**Status:** FROZEN with [ADMIT-V1-SET.md](./ADMIT-V1-SET.md)  
**SRID target for LU spatial:** EPSG:**3006** (SWEREF99 TM)  
**Identity:** `source_sha256` (Pass 2) → import manifest → `version_hash` at materialization → PostGIS layer  

Only **ADMIT** rows may be imported. OUT_OF_SCOPE / BLOCKED rows have no import contract.

Full digests are authoritative; they match [master-walk-pass2-sha-ledger.json](./master-walk-pass2-sha-ledger.json).

---

## ADMIT contracts

| layer_id | source_id | source_version | source_sha256 | format | expected geometry | srid | validity_rules | provenance | PostGIS target | import_registry |
|---|---|---|---|---|---|---|---|---|---|---|
| `lu.property_unit` | `Lantmateriet/Fastighetsindelning_Nationell/Registerenhetsomradesytor/2026-06-28` | 2026-06-28 | `4ed76ac82310f157c1e74732e86514c789d97425971f49a508a78110ca2dfef5` | gpkg | MultiPolygon | 3006 | non-empty geom; fail-closed if SRID≠3006 or size≠1602412544 | LM | `env.registerenhetsomradesytor` → sync `core.property_unit` | yes |
| `lu.water_wells` | `SGU/brunnar/2026-06-19` | 2026-06-19 | `2b4b514f8b18a1a614d9aeac75c32eff8c52a3864c54770be112fd88fa263ddc` | gpkg | Point | 3006 | non-empty geom; query LIMIT/budget | SGU; size 619614208 | `env.sgu_well` | yes (`brunnar`) |
| `lu.ebh` | `LST/EBH_Potentiellt_fororenade_omraden/2026-07-23` | 2026-07-23 | `02fccffc07abaaf1775c8333d660fa60fdecea0c3bb664335892764c8486d186` | gpkg | MultiPolygon | 3006 | non-empty geom; size 17469440 | LST | `env.ebh_potentiellt_fororenade_omraden` | yes |
| `lu.protected_area` | `Naturvardsverket/SkyddadeOmraden/Naturreservat/legacy-adopted-2026-07-20` | legacy-adopted-2026-07-20 | `983772bf129d14326c43aa5d08f152e65604778d392c28ea4fee0c4e838af9ae` | shp | MultiPolygon | 3006 | shp+sidecars; size 18188732 | NV | `env.protected_area` | yes |
| `lu.water_protection` | `Naturvardsverket/Vatten/Vattenskyddsomrade/legacy-adopted-2026-07-20` | legacy-adopted-2026-07-20 | `ba6fdd88fa478d9b930a41153d03b84a34b086de8d6c5aa0f6b63c0b4dd6ff18` | shp | MultiPolygon | 3006 | **NV sole** into `env.water_protection_area`; forbid `VISS/lst_vattenskydd`; forbid any topo/hydro substitute; size 20263912 | NV | `env.water_protection_area` | yes (`Naturvardsverket/Vatten/Vattenskyddsomrade` only) |
| `lu.natura2000` | `Naturvardsverket/Natura2000/2026-05-08/SPA_Rikstackande` | 2026-05-08 | `a5d665ae7bfde9ebeaa4883d5db7bbf70aea9cb7ad5a3f621c4cdbc003ad7f02` | shp | MultiPolygon | 3006 | SPA rikstäckande only v1; SCI = later wave; size 14438620 | NV | `env.natura2000_area` | yes (`Natura2000/Omrade`) |
| `lu.flood_risk` | `MSB/oversvamning_nationell/2026-07-23` | 2026-07-23 | `57a57b47bb6449832a0bc84aea6b748f123a007528b379c3946a2aa531fc5fe6` | gpkg | Polygon/MultiPolygon | 3006 | non-empty geom; size 192106496 | MSB | `climate.flood_risk_area` | yes |
| `lu.soil_type` | `SGU/Jordarter25k100k/2026-06-13_123533` | 2026-06-13_123533 | `11bbf1587f67d5383a25cd19030b6e36b98ecdb80e32372fd0c2824736bf561a` | gpkg | MultiPolygon | 3006 | non-empty geom; size 1497083904 | SGU | `env.sgu_soil_type_25k_100k` | yes (`Jordarters25k100k`) |
| `lu.landslide` | `SGU/Jordskred/2026-07-06_035736` | 2026-07-06_035736 | `1bd3b614b55bb9975df48c3be92837b21dd2f4980afd453c2f1c1ac8a0fc6afa` | gpkg | Geometry | 3006 | non-empty geom; size 13803520 | SGU | `env.sgu_landslide_feature` | yes (`Jordskred`) |
| `lu.viss_waterbody` | `SMHI/water_catchment_svar_2022/legacy-adopted-2026-07-20` | legacy-adopted-2026-07-20 | `3b60afd33a7f27c6d5c8e4ed8cf34b8d77204f6443ad9fcc1f9f678f30a0e6fe` | gpkg | MultiPolygon | 3006 | Authority **SMHI SVAR**; not live VISS WFS; size 802562048 | SMHI | `hydro.water_catchment` | yes |
| `lu.sks_nature` | `Skogsstyrelsen/SksNyckelbiotoper/2026-06-28_121057` | 2026-06-28_121057 | `ac3a7741f6ddcd6faf307625ab560ff61b0a6ddedab1dbbf806ec9b728f48cba` | gpkg | MultiPolygon | 3006 | non-empty geom; size 77860864 | SKS | `env.sks_nyckelbiotoper` | yes |

### Not importable in v1

| layer_id / need | status | reason | source_sha256 (retained) |
|---|---|---|---|
| `lu.raa_culture` | OUT_OF_SCOPE | No IMPORT_REGISTRY | `b45ada14aa6807d4ee52b32720666500991d874406ea5849b5143e7c2f5afe11` |
| LST / `VISS/lst_vattenskydd` | OUT_OF_SCOPE | NV XOR winner = NV; registry dual-target forbidden | — (no Pass 2 master path) |
| `lu.topo_water` | BLOCKED | SHA recorded; **no** IMPORT_REGISTRY; **not** a water_protection substitute | `c563aed7f2d16d1772b4b5941970c2c782d503c944920291fcaaf9b4faac5fd4` |

---

## SpatialLayerRegistry mapping (post-import)

| logical name (today) | layer_id |
|---|---|
| `water` | `lu.water_wells` |
| `ebh` | `lu.ebh` |
| `protected_area` | `lu.protected_area` |

Broader ADMIT layers may be imported before UI/rules consume them.

---

## Materialization proof (at import time)

```text
source_sha256 (this contract / Pass 2 ledger)
import_manifest_id
dataset_version_hash
import_timestamp
layer_id
row_count
```

Mismatch of `source_sha256` or `size_bytes` vs Pass 2 → **fail closed**.
