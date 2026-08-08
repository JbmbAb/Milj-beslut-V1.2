# Master Walk Pass 2 — SHA status

**Status:** BLOCKED — master mount unavailable  
**Requirement:** `source_sha256` **must** exist for Admit v1 candidates  
**Empty PostGIS:** still BLOCKED  

## What happened

1. Pass 1 completed (`957f38492c05b159`) with 65 410 candidates.  
2. Pass 2 script prepared: `scripts/import/master-walk-pass2-sha.mjs`  
   - stream SHA-256 in 4 MiB chunks  
   - retry on `ECANCELED` / `EIO` (Shared Drive)  
   - stores `size_bytes` with hash  
   - optional `ogrinfo` geometry/SRID  
3. First hash attempt on national property GPKG hit `ECANCELED` on `H:`.  
4. Subsequent checks: **`H:\` is not mounted**; `D:\GEO_Master_Archive_Runtime\Data` is empty.  

Without a readable master root, SHA cannot be produced. Invented or placeholder hashes are **not** allowed.

## Canonical files waiting for SHA

| layer_id | Relative path under `Data/` |
|---|---|
| `lu.property_unit` | `Lantmateriet/Fastighetsindelning_Nationell/Registerenhetsomradesytor/2026-06-28/raw/registerenhetsomradesytor_nationell.gpkg` |
| `lu.water_wells` | `SGU/brunnar/2026-06-19/raw/brunnar.gpkg` |
| `lu.ebh` | `LST/EBH_Potentiellt_fororenade_omraden/2026-07-23/raw/ebh_potentiellt_fororenade_omraden.gpkg` |
| `lu.protected_area` | `Naturvardsverket/SkyddadeOmraden/Naturreservat/legacy-adopted-2026-07-20/NR_polygon.shp` |
| `lu.water_protection` | `Naturvardsverket/Vatten/Vattenskyddsomrade/legacy-adopted-2026-07-20/VSO_polygon.shp` |
| `lu.natura2000` | `Naturvardsverket/Natura2000/2026-05-08/SPA_Rikstackande/SPA_rikstackande.shp` |
| `lu.raa_culture` | `RAA/Kulturhistoriska_lamningar/2026-06-29/raw/lämningar_sverige.gpkg` |
| `lu.flood_risk` | `MSB/oversvamning_nationell/2026-07-23/raw/msb_oversvamning_nationell.gpkg` |
| `lu.soil_type` | `SGU/Jordarter25k100k/2026-06-13_123533/raw/Jordarter25k100k.gpkg` |
| `lu.landslide` | `SGU/Jordskred/2026-07-06_035736/raw/extracted/jordskred_raviner.gpkg` |
| `lu.viss_waterbody` | `SMHI/water_catchment_svar_2022/legacy-adopted-2026-07-20/SVAR2022_vattenforekomstavrinningsomraden.gpkg` |
| `lu.sks_nature` | `Skogsstyrelsen/SksNyckelbiotoper/2026-06-28_121057/raw/nyckelbiotoper.gpkg` |
| `lu.topo_water` | `Lantmateriet/Topografi50/hydrografi_sverige/hydrografi_sverige.gpkg` |

## Resume when mount is back

```powershell
# Ensure Google Drive / H: (or set MASTER_ARCHIVE_ROOT to the live Data parent)
Test-Path "H:\Delade enheter\Miljöbeslut\GEO_Master_Archive\Data"

$env:MASTER_ARCHIVE_ROOT = "H:\Delade enheter\Miljöbeslut\GEO_Master_Archive"
node scripts/import/master-walk-pass2-sha.mjs
```

Outputs:

- `storage/manifests/admit-v1/master-walk-pass2-sha-ledger-latest.json`
- `docs/architecture/admit-v1/master-walk-pass2-sha-ledger.json`

## Gate

```text
Pass 1 metadata     ✅
Pass 2 SHA          ⛔ waiting for master mount
Admit v1 freeze     ⛔
empty PostGIS       ⛔
```
