**Legal Ingest Architecture**

Den samlade ingest-arkitekturen för rättskällor bygger nu på två lager:

- Prisma för katalogmetadata, styrning, nyckelkoppling, diarienummer och matrisprojektion
- PostGIS för spatiala dataset som ska importeras som geometri i särskilda scheman

**Källor**

- Dataportal v2: normaliserade distributionsposter från `storage/ingest/legal/dataportal-env-v2`
- Domstolsverket RSS: domar och avgöranden via `domstolRssService`
- Kommunala diarier: indexrad per kommun via `storage/ingest/legal/kommunala-diarier/index.csv`
- Rättspraxis: metadatafiler under `storage/ingest/legal/rattspraxis/metadata`
- Kuraterade grundförfattningar: fem centrala metadata-källor under `server/modules/legal/catalogs/foundationLegalSources.ts`

**Prisma**

- `LegalSourceRecord` är den gemensamma katalogtabellen för externa rättskällor
- `JudgmentRecord` behålls som kompatibilitetsmodell för Domstolsverket RSS
- `RequirementMatrixRow.legalSourceId` gör att en extern rättskälla kan projiceras direkt in i kravmatrisen

**PostGIS**

- Spatiala rättskälledataset landar i `legal.source_dataset`
- Metadata i Prisma anger `storageTarget`, `postgisSchema` och `postgisTable`
- RAA-data routas mot `culture.*`, SMHI mot `climate.*`, övriga spatiala källor mot `legal.*` eller `env.*`

**Flöde**

1. Hämta eller läs råkällor lokalt
2. Normalisera text med mojibake-reparation
3. Klassificera lagringsmål: `PRISMA`, `POSTGIS`, `FILESYSTEM` eller `REVIEW_QUEUE`
4. Upserta `LegalSourceRecord`
5. Skapa eller uppdatera `RequirementMatrixRow` när källan är relevant för praxis, domar eller beslut

Kuraterade grundförfattningar synkas med:

```powershell
npm run ingest:legal:foundations
```

Detta steg skriver katalogmetadata till `LegalSourceRecord` med `sourceSystem=SFS` och
`storageTarget=PRISMA`. Eftersom det rör sig om metadata och inte fulltext ska dessa
poster inte auto-projiceras till kravmatrisen.

Om fokus i stället ligger på att först ladda ner de officiella källfilerna för granskning
eller vidare bearbetning finns nu även ett separat download-steg:

```powershell
npm run download:legal:foundations
```

Detta kommando hämtar varje kuraterad grundförfattning från dess officiella källa och sparar
råfil samt `manifest.json` under `dossiers/knowledge_base/legal/foundation-sources/`.

För ett bredare första svep över kuraterad juridik och vägledning finns även:

```powershell
npm run download:legal:curated
```

Detta kommando laddar ner unika källor från både grundförfattningar och avloppsspårets
vägledningsunderlag till `dossiers/knowledge_base/legal/curated-downloads/`.

För att även köra Boverkets befintliga kunskapsinhämtning i samma svep:

```powershell
npm run download:legal:all
```

**Körning**

Begränsad sync:

```powershell
npm run ingest:legal:sources -- --max-records 50
```

Full sync:

```powershell
npm run ingest:legal:sources -- --confirm
```
