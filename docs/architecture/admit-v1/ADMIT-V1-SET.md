# Admit v1 Set — Frozen

**Status:** FROZEN  
**SHA ledger:** Pass 2 / [master-walk-pass2-sha-ledger.json](./master-walk-pass2-sha-ledger.json)  
**Gate:** [ADR-POSTGIS-ADMIT-V1.md](../ADR-POSTGIS-ADMIT-V1.md)  
**Contracts:** [LAYER-ID-CONTRACTS-V1.md](./LAYER-ID-CONTRACTS-V1.md)

`SHA_RECORDED` alone never admits. This document records **authority decisions** and the resulting Admit v1 set.

Empty PostGIS is allowed **only after** this set + layer_id contracts are frozen (this freeze).

---

## Authority decisions

### 1. Vattenskydd — NV XOR LST

| Option | Master evidence | Decision |
|---|---|---|
| **NV** | `Data/Naturvardsverket/Vatten/Vattenskyddsomrade/…/VSO_polygon.shp` + SHA `ba6fdd88…` | **ADMIT** as sole water-protection master |
| **LST** / `VISS/lst_vattenskydd` | No LST vattenskydd path in Pass 1; registry dual-target exists but must not load | **OUT_OF_SCOPE v1** |

**Rule:** Do not import LST (or dual tables) for vattenskydd in v1.

**Import anti-confusion (mandatory):**

```text
env.water_protection_area  ← ONLY Naturvardsverket/Vatten/Vattenskyddsomrade
                           ← NEVER VISS/lst_vattenskydd
                           ← NEVER lu.topo_water / Topografi50 hydrografi
```

`lu.topo_water` is a separate need (topo hydro foundation). It stays **BLOCKED** and must not be used as a substitute or second source for water protection.

### 2. RAÄ / kulturmiljö

| Option | Evidence | Decision |
|---|---|---|
| ADMIT | Requires IMPORT_REGISTRY + harvest manifest | Not available |
| **OUT_OF_SCOPE v1** | SHA exists (`b45ada14…`) but no registry key | **OUT_OF_SCOPE v1** |

### 3. Topo water

| Option | Evidence | Decision |
|---|---|---|
| ADMIT | Requires IMPORT_REGISTRY for Topografi50/hydrografi | Missing |
| **BLOCKED** | SHA `c563aed7…` retained | **BLOCKED** until registry + re-decide |

---

## Decision ledger

| layer_id | authority | admit_status | import_registry | source_sha256 |
|---|---|---|---|---|
| `lu.property_unit` | Lantmäteriet | **ADMIT** | yes | `4ed76ac82310f157c1e74732e86514c789d97425971f49a508a78110ca2dfef5` |
| `lu.water_wells` | SGU | **ADMIT** | yes | `2b4b514f8b18a1a614d9aeac75c32eff8c52a3864c54770be112fd88fa263ddc` |
| `lu.ebh` | Länsstyrelsen | **ADMIT** | yes | `02fccffc07abaaf1775c8333d660fa60fdecea0c3bb664335892764c8486d186` |
| `lu.protected_area` | Naturvårdsverket | **ADMIT** | yes | `983772bf129d14326c43aa5d08f152e65604778d392c28ea4fee0c4e838af9ae` |
| `lu.water_protection` | Naturvårdsverket | **ADMIT** | yes (NV only) | `ba6fdd88fa478d9b930a41153d03b84a34b086de8d6c5aa0f6b63c0b4dd6ff18` |
| `lu.natura2000` | Naturvårdsverket | **ADMIT** | yes | `a5d665ae7bfde9ebeaa4883d5db7bbf70aea9cb7ad5a3f621c4cdbc003ad7f02` |
| `lu.flood_risk` | MSB | **ADMIT** | yes | `57a57b47bb6449832a0bc84aea6b748f123a007528b379c3946a2aa531fc5fe6` |
| `lu.soil_type` | SGU | **ADMIT** | yes | `11bbf1587f67d5383a25cd19030b6e36b98ecdb80e32372fd0c2824736bf561a` |
| `lu.landslide` | SGU | **ADMIT** | yes | `1bd3b614b55bb9975df48c3be92837b21dd2f4980afd453c2f1c1ac8a0fc6afa` |
| `lu.viss_waterbody` | SMHI (SVAR) | **ADMIT** | yes | `3b60afd33a7f27c6d5c8e4ed8cf34b8d77204f6443ad9fcc1f9f678f30a0e6fe` |
| `lu.sks_nature` | Skogsstyrelsen | **ADMIT** | yes | `ac3a7741f6ddcd6faf307625ab560ff61b0a6ddedab1dbbf806ec9b728f48cba` |
| `lu.topo_water` | Lantmäteriet | **BLOCKED** | **no** | `c563aed7f2d16d1772b4b5941970c2c782d503c944920291fcaaf9b4faac5fd4` |
| `lu.raa_culture` | RAÄ | **OUT_OF_SCOPE** | **no** | `b45ada14aa6807d4ee52b32720666500991d874406ea5849b5143e7c2f5afe11` |
| — (LST vattenskydd) | Länsstyrelsen | **OUT_OF_SCOPE** | ignore `VISS/lst_vattenskydd` | — |

Paths / sizes remain in the Pass 2 SHA ledger (file bindings unchanged — no re-hash).

---

## Freeze criteria (ADR checklist)

| # | Criterion | Met? |
|---|---|---|
| 1 | MM + property `ADMIT` with `source_sha256` | yes |
| 2 | Vattenskydd exactly one `ADMIT` (NV); LST OOS | yes |
| 3 | RAÄ explicit OUT_OF_SCOPE v1 | yes |
| 4 | No implicit include | yes |
| 5 | `layer_id` contracts for every ADMIT | yes → LAYER-ID-CONTRACTS-V1 |

---

## Import priority (when empty PostGIS is opened)

```text
1. lu.property_unit
2. Magic Moment: lu.water_wells → lu.ebh → lu.protected_area
3. Broad ADMIT: water_protection, natura2000, flood_risk, soil_type,
                landslide, viss_waterbody, sks_nature
4. Never: OUT_OF_SCOPE / BLOCKED
```

Validation acceptance = Magic Moment E2E against the **new** DB.

---

## Explicitly still paused until you green-light rebuild ops

- Sanitize / empty PostGIS install  
- Actual imports  
- L3 rechunk  
- Re-hash of the 13 canonical files  
- Registry work for `lu.topo_water` / RAÄ wave  

## Next

```text
Admit v1 set           ✅
layer_id contracts     ✅
        ↓
empty PostGIS          ← first allowed rebuild step (HITL)
        ↓
import ADMIT rows only
        ↓
validation + Magic Moment acceptance
```
