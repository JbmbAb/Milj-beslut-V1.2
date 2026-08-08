# Master Walk Pass 1 — Candidate Manifest (metadata only)

**Status:** COMPLETE  
**Survey id:** `957f38492c05b159`  
**Generated:** 2026-08-08 (local run)  
**SHA:** none (Pass 1)  
**Empty PostGIS:** still BLOCKED  

Gate: [ADR-POSTGIS-ADMIT-V1.md](../ADR-POSTGIS-ADMIT-V1.md)

## What was done

Full walk of `GEO_Master_Archive/Data/` (19 provider folders):

| Metric | Value |
|---|---:|
| Files seen | 225 511 |
| Spatial/manifest candidates | 65 410 |
| Errors | 0 |
| Elapsed | ~128 s |

Script: `scripts/import/master-walk-pass1.mjs`  

Runtime artifacts (gitignored under `/storage/`):

- `storage/manifests/admit-v1/master-walk-pass1-candidates-latest.json`
- `storage/manifests/admit-v1/master-walk-pass1-candidates.csv`

Commitable summary: `docs/architecture/admit-v1/master-walk-pass1-summary.json`

## Priority tiers (Pass 1 hints)

| Tier | Meaning | Candidate count |
|---:|---|---:|
| 1 | Property / admin foundation | 25 886 |
| 2 | Magic Moment (wells / EBH / protected) | 57 |
| 3 | Broad LU candidates | 387 |
| 4 | Other / unclassified | 39 075 |
| 9 | Legacy ops / migration noise | 5 |

Note: Tier 1 is inflated by LM STAC municipal archives matching property heuristics. Pass 2 must prefer **national merge / canonical** payloads, not every kommun-ZIP.

## Authority-critical observations

### Vattenskydd (NV xor LST)

Pass 1 found **NV only** under heuristic `lu.water_protection`:

- `Data/Naturvardsverket/Vatten/Vattenskyddsomrade/legacy-adopted-2026-07-20/VSO_polygon.shp`

No LST path matched `vattenskydd` in this survey. LST folder has EBH and other datasets — if LST vattenskydd exists under another name, Pass 2 discovery must locate it before an NV-only `ADMIT`. Until then: **dual-source conflict not fully materialized in archive naming**; decision still required before any import of water protection.

### RAÄ

11 candidates under `Data/RAA/` / `lu.raa_culture`. Still **BLOCKED** until IMPORT_REGISTRY + manifest → `ADMIT`, or explicit `OUT_OF_SCOPE v1`.

### Magic Moment raw candidates (multiple harvest versions)

| Layer | Authority | Notes |
|---|---|---|
| `lu.water_wells` | SGU | Several dated harvests (GPKG ~620 MB + ZIPs). Pass 2 picks **one** version + SHA. |
| `lu.ebh` | LST | Multiple ZIP/GPKG dated folders. Pass 2 picks **one**. |
| `lu.protected_area` | NV | `NR_polygon.shp` under `legacy-adopted-2026-07-20`. |

## Pass 2 policy (next)

```text
candidate
   ↓
authority known?
   ├── NO → BLOCKED
   └── YES
        ↓
format understood?
   ├── NO → BLOCKED
   └── YES
        ↓
stream SHA-256 (+ size_bytes)
        ↓
geometry/SRID inspection
        ↓
ADMIT / OUT_OF_SCOPE / BLOCKED
```

Order for deep analysis:

1. Property (canonical national / property_unit source — not all STAC zips)  
2. Magic Moment three  
3. Broad LU: vattenskydd, Natura 2000, RAÄ, flood, soil/landslide, VISS, SKS  
4. Remainder — classify only; SHA deferred  

Do **not** hash the entire 65k set. Do **not** open empty PostGIS.
