**Dataportal Harvester v2**

Den harvester som tidigare anvands i [download-dataportal-env.ts](/c:/Users/jimmy/Desktop/utvecklings arbete/Kod/Ny mapp/remix\_-copy-of-Miljobeslut.se-portal/scripts/ingest/download-dataportal-env.ts) betraktas nu som ett v1-snapshotflode.
v2 ar byggd for inventering, klassificering och manuell styrning innan fortsatt hamtning eller operativ anvandning.

**Principer**

- v1-data ligger kvar oforandrad under [dataportal-env](/c:/Users/jimmy/Desktop/utvecklings arbete/Kod/Ny mapp/remix\_-copy-of-Miljobeslut.se-portal/storage/ingest/legal/dataportal-env)
- v2 skriver endast till [dataportal-env-v2](/c:/Users/jimmy/Desktop/utvecklings arbete/Kod/Ny mapp/remix\_-copy-of-Miljobeslut.se-portal/storage/ingest/legal/dataportal-env-v2)
- inga curated-uttag ar avsedda for produktionsbruk utan manuell granskning
- distributioner klassificeras som `open`, `auth_required`, `manual_review` eller `irrelevant`

**Kodstruktur**

- Runner: [dataportal-harvester-v2.ts](/c:/Users/jimmy/Desktop/utvecklings arbete/Kod/Ny mapp/remix\_-copy-of-Miljobeslut.se-portal/scripts/ingest/dataportal-harvester-v2.ts)
- Core: [dataportal-v2/core](/c:/Users/jimmy/Desktop/utvecklings arbete/Kod/Ny mapp/remix\_-copy-of-Miljobeslut.se-portal/scripts/ingest/dataportal-v2/core)
- Providers: [dataportal-v2/providers](/c:/Users/jimmy/Desktop/utvecklings arbete/Kod/Ny mapp/remix\_-copy-of-Miljobeslut.se-portal/scripts/ingest/dataportal-v2/providers)

**V2-utdata**

- `snapshots/<snapshot-id>/manifest.json`
- `inventory/records/<contextId>/<entryId>/*.json`
- `inventory/distributions.ndjson`
- `inventory/datasets.json`
- `inventory/state/progress.json`
- `inventory/state/current-request.json`
- `curated/distributions.ndjson`
- `curated/datasets.json`
- `reports/summary.json`
- `reports/summary.md`

**Korning**
Begransad inventering:

```powershell
node scripts/ingest/dataportal-harvester-v2.ts --max-datasets 25 --probe
```

Full inventering:

```powershell
node scripts/ingest/dataportal-harvester-v2.ts --confirm
```

Full inventering med URL-probe:

```powershell
node scripts/ingest/dataportal-harvester-v2.ts --confirm --probe --resume
```

**Auth-strategier**

- `none`: oppen distribution
- `api_key_substitution`: URL-platshallare eller header kan matchas mot env
- `oauth_client_credentials_placeholder`: credentials finns men tokenhamtning ska granskas provider-specifikt
- `manual_external_access`: extern portal eller behorighetsflode maste hanteras manuellt

**Providerregistret i v2**

- Lantmateriet
- Trafikverket
- SLU / ArtDatabanken
- DOI landing pages
- Default provider

**Manuell granskningspunkt**

- `curated/*` ar endast en arbetsko
- `reports/summary.*` ska lasas innan nagon fortsatt automatisk hamtning eller import byggs
- auth-krav och juridiska villkor maste verifieras per provider innan data anvands operativt
