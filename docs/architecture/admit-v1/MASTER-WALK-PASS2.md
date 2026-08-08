# Master Walk Pass 2 — SHA ledger

**Status:** COMPLETE — SHA ledger frozen  
**Generated:** 2026-08-08T09:22:40Z  
**Elapsed:** ~452 s  
**Empty PostGIS:** still BLOCKED  

**Important:** `SHA_RECORDED` is **not** `ADMIT`.  
Next gate is authority decision → ADMIT / OUT_OF_SCOPE / BLOCKED → Admit v1 set → layer_id contract → only then empty PostGIS.  
No re-hash of these 13 files while path + `size_bytes` + `source_sha256` remain the verified binding.

Ledger: [master-walk-pass2-sha-ledger.json](./master-walk-pass2-sha-ledger.json)  
Script: `scripts/import/master-walk-pass2-sha.mjs` (stream SHA-256, 4 MiB chunks, Shared Drive retries)

## Results

| layer_id | size | source_sha256 (prefix) | status |
|---|---:|---|---|
| `lu.property_unit` | 1602 MB | `4ed76ac82310f157…` | SHA_RECORDED |
| `lu.water_wells` | 620 MB | `2b4b514f8b18a1a6…` | SHA_RECORDED |
| `lu.ebh` | 17 MB | `02fccffc07abaaf1…` | SHA_RECORDED |
| `lu.protected_area` | 18 MB | `983772bf129d1432…` | SHA_RECORDED |
| `lu.water_protection` | 20 MB | `ba6fdd88fa478d9b…` | **BLOCKED** — NV xor LST authority |
| `lu.natura2000` | 14 MB | `a5d665ae7bfde9eb…` | SHA_RECORDED |
| `lu.raa_culture` | 2288 MB | `b45ada14aa6807d4…` | **BLOCKED** — registry or OUT_OF_SCOPE |
| `lu.flood_risk` | 192 MB | `57a57b47bb644983…` | SHA_RECORDED |
| `lu.soil_type` | 1497 MB | `11bbf1587f67d538…` | SHA_RECORDED |
| `lu.landslide` | 14 MB | `1bd3b614b55bb997…` | SHA_RECORDED |
| `lu.viss_waterbody` | 803 MB | `3b60afd33a7f27c6…` | SHA_RECORDED |
| `lu.sks_nature` | 78 MB | `ac3a7741f6ddcd6f…` | SHA_RECORDED |
| `lu.topo_water` | 425 MB | `c563aed7f2d16d17…` | SHA_RECORDED |

\* Full digests + paths in the JSON ledger. Geometry/SRID via `ogrinfo` was unavailable in this environment (null) — can be filled in a follow-up inspect pass without re-hash when `size_bytes` unchanged.

## Next gate (not PostGIS)

1. **Authority decisions**  
   - Vattenskydd: NV xor LST (SHA exists for NV VSO)  
   - RAÄ: IMPORT_REGISTRY → ADMIT **or** explicit OUT_OF_SCOPE v1 (SHA exists)  
2. Promote `SHA_RECORDED` → `ADMIT` / `OUT_OF_SCOPE` / `BLOCKED`  
3. Freeze Admit v1 set + `layer_id` contracts  
4. Only then: empty PostGIS  

Identity chain ready for admitted rows:

```text
source_sha256 (+ size_bytes)
      ↓
import manifest
      ↓
dataset/version hash
      ↓
PostGIS layer
```
