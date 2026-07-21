# Import policy: Librarian-only (legacy sunset)

Status: gällande från 2026-06-22.

## Beslut

All **ny permanent geodata** ska importeras till PostGIS **endast** via:

```text
scripts/import/import-librarian-manifest.ts
```

med obligatoriska faser:

1. `--mode plan` (dry-run)
2. `--mode import-staging --execute` (ogr2ogr → `lm_staging.*` + staging QA)
3. `--mode promote --execute` (promote audit + post-promote index/analyze + valfri map-smoke)

Källa ska vara canonical Master-arkiv (`GEO_Master_Archive/Data/...`) med giltig `manifest.json`.

## Mimers Brunn golden rule

**Default-aktion:** Skörda om från originalkällan enligt Mimers Brunn när källan är tillgänglig och nedladdningen är rimligt snabb. Resultatet ska landa i canonical path med manifest v2, `files_detail`, SHA-256 och storlek per fil innan Librarian-import.

**Legacy-adoption:** Tillåts endast när källan har försvunnit, datamängden är extremt tids- eller kostnadskrävande att hämta igen, eller leveransen kräver manuell export/tillståndsprocess. Varje undantag ska dokumenteras och granskas.

**Definition of Done:** Ett kärndataset är inte stängt förrän audit visar 0 % `checksum_missing` och 0 % `legacy_path_mismatch`.

## Legacy sunset

| Fas | Datum | Krav |
|-----|-------|------|
| **Freeze** | 2026-06-22 | Nya dataset får inte läggas till legacy bulk-importer |
| **Sunset** | **2026-09-01** | Legacy-skript som skriver direkt till prod-tabeller får inte användas utan undantagsbeslut |
| **Efter sunset** | 2026-09-01+ | Endast librarian + dokumenterat undantag (human in the loop) |

## Legacy-import (utfasas)

Dessa vägar kringgår enhetlig QA och ska **inte** användas för ny data:

- `scripts/import/sguBulkImportEngine.ts`
- `scripts/import/bulk-import-platform-all.ts`
- `scripts/import/bulk-import-sgu.ts`
- `scripts/import/bulk-import-sgu-api-all.ts`
- `scripts/import/import-heavy-geodata.ts`
- `scripts/import/lastkajenImportEngine.ts` (direkt prod-import)
- Ad-hoc `ogr2ogr`-skript utan manifest och `PostgisImportBatch`

**Tillåtna undantag:**

- Engångsmigration med skriftligt godkännande och post-hoc manifest
- Harvest/download-only (`harvest-*-to-master.ts`) — skriver **inte** till PostGIS
- `npm run db:spatial` och underhållsskript (index, partition, vacuum)

## QA-kontrakt (librarian)

Staging QA (efter ogr2ogr):

- `COUNT(*)`
- `ST_SRID(geom)` = 3006
- `COUNT(*) WHERE NOT ST_IsValid(geom)` = 0

Promote audit:

- Jämför staging vs prod före `TRUNCATE`
- Verifiera radantal efter promote
- Spara `PostgisImportBatch.row_count`

Post-promote:

- `VACUUM ANALYZE` på prod
- GiST-index på `geom`
- Map-smoke mot `/api/layers/dataset/:key` om `BASE_URL` är satt

## Referenser

- `scripts/import/importLibrarianQa.ts`
- `knowledge-base/MIMER_LIBRARIAN.md`
- `docs/architecture/mimers-brunn-offline-first.md`
