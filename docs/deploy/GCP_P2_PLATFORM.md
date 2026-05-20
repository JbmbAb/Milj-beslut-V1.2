# GCP P2 – plattform: lagring, köer, SQL, health

Komplement till [DEPLOY_GCP.md](DEPLOY_GCP.md). Täcker hårdnande av Cloud SQL (PostGIS/pgvector), varaktiga filer i GCS, flytt av in-process schemaläggning, samt liveness/readiness.

## 1. Health: `/health` vs `/ready`

| Sökväg    | Syfte     | Svar 200 när |
|-----------|-----------|--------------|
| `GET /health`  | Liveness  | Processen svarar (ingen DB). Använd för enkel "är containern uppe". |
| `GET /ready`   | Readiness | PostgreSQL svarar (`SELECT 1`). Inkluderar `database`, `vertex`, `storage` (GCS vs lokal varning i prod). |

Uptime/lastbalansering i GCP bör använda **`/ready`** (eller både liveness = `/health`, readiness = `/ready` om stöd finns).

## 2. Cloud Storage för dokument

- Sätt **`GCS_DOCUMENTS_BUCKET`** (och valfritt `GCS_DOCUMENTS_PREFIX=documents`).

- Uppladdade filer sparas då som `gs://<bucket>/documents/<projectId>/<diskName>` i `DocumentRecord.absolutePath`. Utan bucket används lokal sökväg under `storage/uploads` (utveckling).

- Runtime-SA behöver `roles/storage.objectUser` (eller motsv.) på bucken. Se [DEPLOY_GCP.md](DEPLOY_GCP.md) steg 5.

- **Migrering:** Befintliga rader med lokala paths måste förbli oförändrade tills filer flyttas till GCS och paths uppdateras (separat underhållsjobb).

## 3. In-process workers → Cloud Scheduler / Cloud Tasks / Cloud Run Jobs

När `SEARCH_WORKER_ENABLED=false` startas **inte** `setInterval` i [server/services/searchWorker.ts](../../server/services/searchWorker.ts). Trigga då t.ex. var 30–60 s:

`POST /api/internal/background/search-worker/tick` med JSON `{"maxJobs":8}` och header `X-Internal-Token: <INTERNAL_CRON_TOKEN>`.

När `GDPR_CRON_IN_PROCESS=false` körs **inte** dygns-CRON för GDPR i [server/index.ts](../../server/index.ts). Trigga t.ex. dagligen:

`POST /api/internal/background/gdpr-maintenance` med samma token.

1. Skapa hemlighet: `gcloud secrets create INTERNAL_CRON_TOKEN --data-file=-`
2. Mappa till Cloud Run:  
   `gcloud run services update SERVICE --set-secrets=INTERNAL_CRON_TOKEN=INTERNAL_CRON_TOKEN:latest`
3. Cloud Scheduler (OIDC rekommenderas mot intern endpoint – alternativt hemlig header via Secret Manager + curl i jobb):

```bash
# Exempel: autentiserad anropare (justerbart)
gcloud scheduler jobs create http miljobeslut-search-worker \
  --location=europe-west1 \
  --schedule="*/1 * * * *" \
  --uri="https://SERVICE-URL/api/internal/background/search-worker/tick" \
  --http-method=POST \
  --headers="X-Internal-Token=SECRET_FROM_SM" \
  --message-body='{"maxJobs":8}' \
  --oauth-service-account-email=RUNTIME_SA@PROJECT.iam.gserviceaccount.com
```

(Justera så att token **inte** läggs i klartext i CLI; använd Secret Manager + workload eller generera anrop från Cloud Run Job med inbyggd identitet.)

**Övriga timers** (domstol-RSS, kommun-poll, outlook, audit) kan liknande flyttas stegvis till Scheduler eller en dedikerad **Cloud Run Job**-revision med samma image och annan `command`.

**Cloud Tasks** (asynk HTTP): Lämpligt om ni vill unika retries/deadline per jobb; anropa samma `search-worker/tick` eller en framtida finsnävad handler.

**Pub/Sub:** Push till en mottagare som kör `processSearchJobsOnce` – samma mönster som ovan, med prenumeration + push endpoint.

## 4. Cloud SQL (PostGIS / pgvector) – hårdning, backup, IAM

- **Private IP** + **VPC-connector** (redan i deploy): ingen publik IP på databasen om möjligt.
- **SSL:** Använd Cloud SQL-anslutning via Unix-socket i Cloud Run (`/cloudsql/INSTANCE`) + `cloudsql.instances` på tjänsten.
- **PostGIS + pgvector:** Säkerställ att `scripts/db/spatial-bootstrap.ts` och Prisma-migreringar kör efter större uppgraderingar. Verifiera med `npm run smoke:postgis` mot staging.
- **Backup:** På instansen: inställningar för **automatisk backup** + **PITR** där prisnivå tillåter. Dokumentera RPO/RTO internt.
- **Restore drill (manuell checklista):**  
  1) Skapa klon/återställning till en **testinstans** från backup.  
  2) Kör `prisma migrate status` + röktest av `/ready` mot en tillfällig Cloud Run med `DATABASE_URL` mot klonen.  
  3) Verifiera att `vector`-typ och PostGIS-geometry finns.  
- **IAM:** Använd **minsta behörighet** för runtime-SA: `cloudsql.client`, `secretmanager.secretAccessor`, `aiplatform.user`, `storage.objectUser`, `logging.logWriter`. Undvik `roles/owner` på produktions-SA.
- **Databas-användare:** Separat app-user med begränsade privilegier (inga `SUPERUSER` / `CREATEDB` i app).

## 5. `cloudbuild.yaml` – hemligheter och env

Pipelinen sätter:

- **Secrets (Secret Manager):** `DATABASE_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `SEARCH_ENCRYPTION_KEY_BASE64` (utöka listan enligt er miljö – samma mönster `NAME=NAME:latest`).

- **Env:** `VERTEX_PROJECT_ID`, `VERTEX_LOCATION`, `GCS_DOCUMENTS_BUCKET` (via substitution `_GCS_DOCUMENTS_BUCKET`), `GDPR_CRON_IN_PROCESS=false`, `SEARCH_WORKER_ENABLED=false` så att schemaläggning sker externt.

Lägg `INTERNAL_CRON_TOKEN` i Secret Manager och uppdatera Cloud Run med `--update-secrets` efter första deploy.

## 6. Ytterligare läsning

- [production-readiness-checklist.md](../qa/production-readiness-checklist.md) (P1/P2 kring Secret Manager, `DATABASE_URL`-socket)
- [operations-readiness-pack.md](../qa/operations-readiness-pack.md) om förekommer i repot
