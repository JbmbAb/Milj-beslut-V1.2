# Master Walk Pass 2 — SHA ledger

**Status:** COMPLETE — SHA ledger frozen; decisions promoted in [ADMIT-V1-SET.md](./ADMIT-V1-SET.md)  
**Generated:** 2026-08-08T09:22:40Z  
**Elapsed:** ~452 s  

**Important:** Do **not** re-hash these 13 files while path + `size_bytes` + `source_sha256` remain the verified binding.

Ledger: [master-walk-pass2-sha-ledger.json](./master-walk-pass2-sha-ledger.json)  
Script: `scripts/import/master-walk-pass2-sha.mjs` (stream SHA-256, 4 MiB chunks, Shared Drive retries)

## Results (after authority promote)

| layer_id | size | source_sha256 (prefix) | status |
|---|---:|---|---|
| `lu.property_unit` | 1602 MB | `4ed76ac82310f157…` | **ADMIT** |
| `lu.water_wells` | 620 MB | `2b4b514f8b18a1a6…` | **ADMIT** |
| `lu.ebh` | 17 MB | `02fccffc07abaaf1…` | **ADMIT** |
| `lu.protected_area` | 18 MB | `983772bf129d1432…` | **ADMIT** |
| `lu.water_protection` | 20 MB | `ba6fdd88fa478d9b…` | **ADMIT** (NV sole) |
| `lu.natura2000` | 14 MB | `a5d665ae7bfde9eb…` | **ADMIT** |
| `lu.raa_culture` | 2288 MB | `b45ada14aa6807d4…` | **OUT_OF_SCOPE** v1 |
| `lu.flood_risk` | 192 MB | `57a57b47bb644983…` | **ADMIT** |
| `lu.soil_type` | 1497 MB | `11bbf1587f67d538…` | **ADMIT** |
| `lu.landslide` | 14 MB | `1bd3b614b55bb997…` | **ADMIT** |
| `lu.viss_waterbody` | 803 MB | `3b60afd33a7f27c6…` | **ADMIT** (SMHI SVAR) |
| `lu.sks_nature` | 78 MB | `ac3a7741f6ddcd6f…` | **ADMIT** |
| `lu.topo_water` | 425 MB | `c563aed7f2d16d17…` | **BLOCKED** (no registry) |

\* Full digests + paths in the JSON ledger. Geometry/SRID via `ogrinfo` was unavailable in this environment — follow-up inspect without re-hash when `size_bytes` unchanged.

## Gate

```text
Pass 2 SHA              ✅
Authority decisions     ✅ → ADMIT-V1-SET.md
layer_id contracts      ✅ → LAYER-ID-CONTRACTS-V1.md
empty PostGIS           ← HITL next (sanitize + cold start)
```

Identity chain for ADMIT rows:

```text
source_sha256 (+ size_bytes)
      ↓
import manifest
      ↓
dataset/version hash
      ↓
PostGIS layer
```
