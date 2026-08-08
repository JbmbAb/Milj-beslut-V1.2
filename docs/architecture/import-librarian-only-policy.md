# Import policy: Librarian-only (legacy sunset)

Status: gällande från 2026-06-22. **Körbar sedan 2026-08-08.**

## Enforcement

Policyn var prosa i sexton veckor. Under den tiden höll 34 filer under `scripts/`
förmågan att köra rå SQL mot databasen; två av dem var librarian-vägen. Ett
dokument som trettiotvå skript motsäger i kod är inte plattformens importgrind.

Regeln är nu en invariant i `packages/mps-data-governance/src/GovernedWriteCapability.ts`
med `POSTGIS_RAW_WRITE`, verifierad av `tests/GovernedWriteCapability.test.ts`.
Den är förmågebaserad: den frågar inte om en enskild sats skriver, utan vilka
filer som alls kan skriva. Det är ett svagare påstående om varje rad och ett
betydligt starkare om systemet, eftersom det inte kan kringgås genom att skriva
om en sats.

De trettiotvå befintliga vägarna är frysta som `legacy` med exakt antal. Listan
får krympa och får inte växa: varje ny innehavare fäller bygget med filnamn.
Underhållsskript under `scripts/db/` är undantagna med angivet skäl, i enlighet
med undantaget längre ned i detta dokument.

Samma invariant bevakar ärendegrafen (`CASE_GRAPH_WRITE`): `environmentalCase`
och `caseEvidence` är materialiseringsunderlag, och `mimerBindingAgent.ts` är
strypunkten där. Båda kapabiliteterna bevakas över **samma** omfång
(`scripts`, `server`, `src`, `services`, `packages`), delat i en enda konstant.
Enforcement får inte bero på var anroparen bor: att stänga `script → PostGIS`
men lämna `service → PostGIS` öppen flyttar bara vägen. Första versionen av
modulen gjorde exakt det felet, och det avslöjade åtta innehavare i runtime som
det smalare omfånget aldrig såg.

Fyra av dem är verkliga direktskrivningar till prod utanför librarian. Den
skarpaste är `server/services/propertyUnitService.ts`, som gör fyra
`INSERT INTO` mot `core.property_unit`, `env.sgu_well_actual`,
`env.natura2000_area` och `env.ebh_potentiellt_fororenade_omraden` — permanent
geodata skriven från request-vägen, inklusive EBH-lagret som LU frågar mot. De
återstående fyra använder primitiven enbart för sessionsinställningar
(`SET LOCAL statement_timeout`, `SELECT set_config`) och kan inte skriva data.
De är listade, inte undantagna, och kontrolleras mot att de inte innehåller
någon datamodifierande sats — en dispens är osynlig, en listad fil är granskad.

## Vad invarianten bevisar, och inte

Den etablerar **unikhet**: styrt produktionstillstånd nås genom två dörrar och
inga andra, och varje tredje dörr fäller bygget med filnamn.

Den etablerar inte **auktorisation**: ingen av dörrarna är låst. Librarian och
`mimerBindingAgent` skriver prod direkt, och ingen av dem refererar
`mps-data-governance` — inget godkännande krävs, ingen gate-evidens produceras,
inget karantänsätts vid avslag. Båda är strypunkter, inte grindar.

Att smalna trettiofyra skrivvägar till två är vad som gör låsningen möjlig. Det
är inte låset. Det arbetet bärs av de fem återstående orkestratorportarna.

MAT-I05 är avsiktligt inte spärren här. Den invarianten styr vem som får skapa
`DecisionImpactArtifact`-auktoritet, och importvägen skapar aldrig en sådan. Att
leda ingest genom den skulle innebära att skördaren registreras som
materialization authority — motsatsen till vad spärren skyddar.

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
