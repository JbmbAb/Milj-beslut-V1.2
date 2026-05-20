**Legal Clean Run v3**

Detta spår skapar en helt ny, reproducerbar ingest-körning från början utan att skriva in i gamla blandade mappar.

**Mål**

- hålla gamla arkiv orörda som referens
- köra ny hämtning i en isolerad run-root
- samla `inventory`, `curated`, `downloads`, `review`, `errors` och `reports` i samma körning
- därefter synka filtrerad metadata till Prisma och matrisen

**Run-root**

Standardroten blir:

`storage/ingest/legal-runs/legal-run-YYYY-MM-DD-clean-v3`

Den får minst dessa mappar:

- `raw/`
- `inventory/`
- `curated/`
- `downloads/`
- `review/`
- `errors/`
- `reports/`
- `logs/`
- `manifests/`

**Smoke-run**

Smoke-läget gör en begränsad ny hämtning:

1. `scan-dataportal-env.ts`
2. `download-dataportal-env.ts` för v1-metadata
3. `dataportal-harvester-v2.ts`
4. `dataportal-download-open-v2.ts`
5. `build-municipal-diary-index.ts`
6. `download-domstol-rss.ts`
7. `download-rattspraxis.ts`
8. `sync-legal-sources.ts`

**Körning**

Initiera bara run-root:

```powershell
npm run ingest:legal:clean-run -- --mode init
```

Initiera och kör smoke-run:

```powershell
npm run ingest:legal:clean-run
```

Använd egen run-root:

```powershell
npm run ingest:legal:clean-run -- --run-root storage/ingest/legal-runs/legal-run-2026-03-29-clean-v3
```

**Princip**

Gamla arkiv får ligga kvar som revisionsspår. Nya körningar ska vara isolerade, tidsstämplade och fullt loggade, så att vi alltid kan se exakt vilket råmaterial som gav vilket filterat resultat.
