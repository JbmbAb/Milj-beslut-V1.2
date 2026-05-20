# Deploy-guide — Google Cloud (komplett lösning)

Denna guide ersätter tidigare Fly.io-setup. Hela plattformen kör på Google
Cloud: Cloud Run (app), Cloud SQL for PostgreSQL (PostGIS), Vertex AI (LLM),
Secret Manager (credentials), Cloud Storage (attachments) och Cloud Build (CI/CD).

## Arkitektur

```
┌──────────────────────────────────────────────────────────────────┐
│ GCP-projekt: miljobeslut-prod                                    │
│ Region: europe-west1 (Belgien) — närmast Sverige + Vertex AI     │
│                                                                  │
│  ┌──────────────────────────┐     ┌────────────────────────────┐ │
│  │ Cloud Run: miljobeslut   │────>│ Cloud SQL: miljobeslut-db  │ │
│  │ (Express+WebSocket+SPA)  │     │ Postgres 16 + PostGIS      │ │
│  │ min-instances=1          │     │ privat IP via VPC connector │ │
│  └───────────┬──────────────┘     └────────────────────────────┘ │
│              │                                                   │
│              ├──> Vertex AI (gemini-1.5-pro / flash)              │
│              ├──> Secret Manager (all credentials)                │
│              ├──> Cloud Storage (Outlook attachments)             │
│              ├──> Cloud Logging + Cloud Monitoring                │
│              └──> Cloud Scheduler + Cloud Run Jobs (migrations)   │
│                                                                  │
│  ┌──────────────────────────┐                                    │
│  │ Artifact Registry        │  ← images från Cloud Build         │
│  └──────────────────────────┘                                    │
└──────────────────────────────────────────────────────────────────┘
```

## Förkrav

- Sammanställd variabelchecklista: [ENV_CHECKLIST.md](ENV_CHECKLIST.md) — säkerställ att `BANKID_MOCK_MODE` och `AUTHORITY_MOCK_MODE` **inte** är `true` i produktion (servern loggar annars fel vid start).
- `gcloud` CLI installerat (<https://cloud.google.com/sdk/docs/install>).
- Ägar- eller Editor-roll i GCP-projektet.
- Fakturering aktiverad på projektet (Cloud Run + Cloud SQL är inte gratis).

## Steg 1 — Skapa GCP-projekt och aktivera API:er

```bash
export PROJECT_ID=miljobeslut-prod
export REGION=europe-west1

gcloud projects create $PROJECT_ID --name="Miljöbeslut"
gcloud config set project $PROJECT_ID

gcloud services enable \
  run.googleapis.com \
  sqladmin.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  secretmanager.googleapis.com \
  aiplatform.googleapis.com \
  vpcaccess.googleapis.com \
  storage.googleapis.com \
  cloudscheduler.googleapis.com \
  servicenetworking.googleapis.com
```

## Steg 2 — Cloud SQL med PostGIS

```bash
# Skapa instans (2 vCPU / 4 GB RAM, lagring 20 GB startvärde — skala upp vid behov).
gcloud sql instances create miljobeslut-db \
  --database-version=POSTGRES_16 \
  --tier=db-custom-2-4096 \
  --region=$REGION \
  --availability-type=zonal \
  --storage-size=20GB \
  --storage-type=SSD \
  --storage-auto-increase \
  --network=default \
  --no-assign-ip

# Skapa databas + användare.
gcloud sql databases create miljobeslut --instance=miljobeslut-db
gcloud sql users create miljobeslut_app \
  --instance=miljobeslut-db \
  --password="$(openssl rand -hex 16)"

# Aktivera PostGIS-extension (körs en gång).
gcloud sql connect miljobeslut-db --user=postgres --quiet <<'SQL'
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
SQL
```

Instansens connection name blir `$PROJECT_ID:$REGION:miljobeslut-db`.

## Steg 3 — Artifact Registry

```bash
gcloud artifacts repositories create miljobeslut \
  --repository-format=docker \
  --location=$REGION
```

## Steg 4 — VPC connector (för privat Cloud SQL access)

```bash
gcloud compute networks vpc-access connectors create miljobeslut-vpc \
  --region=$REGION \
  --network=default \
  --range=10.8.0.0/28 \
  --min-instances=2 \
  --max-instances=3
```

## Steg 5 — Service accounts

```bash
# Runtime-SA för Cloud Run: IAM-roller för Vertex, Cloud SQL, Secret Manager.
gcloud iam service-accounts create miljobeslut-runtime \
  --display-name="Miljöbeslut Cloud Run runtime"

RUNTIME_SA="miljobeslut-runtime@$PROJECT_ID.iam.gserviceaccount.com"

for role in \
  roles/aiplatform.user \
  roles/cloudsql.client \
  roles/secretmanager.secretAccessor \
  roles/storage.objectUser \
  roles/logging.logWriter \
  roles/monitoring.metricWriter; do
  gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:$RUNTIME_SA" \
    --role="$role"
done
```

## Steg 6 — Secret Manager

Skapa varje nödvändig hemlighet. Minimum att köra i produktion:

```bash
# Hjälpscript: läs från miljö och skapa Secret Manager-poster.
set_secret() {
  local name=$1
  local value=$2
  printf "%s" "$value" | gcloud secrets create "$name" \
    --replication-policy=automatic \
    --data-file=- 2>/dev/null || \
  printf "%s" "$value" | gcloud secrets versions add "$name" --data-file=-
}

# Obligatoriska (servern startar inte utan dessa)
set_secret DATABASE_URL "postgresql://miljobeslut_app:APP_PWD@/miljobeslut?host=/cloudsql/$PROJECT_ID:$REGION:miljobeslut-db"
set_secret JWT_ACCESS_SECRET "$(openssl rand -hex 32)"
set_secret JWT_REFRESH_SECRET "$(openssl rand -hex 32)"
set_secret SEARCH_ENCRYPTION_KEY_BASE64 "$(openssl rand -base64 32)"

# Lantmäteriet (avgiftsfria tjänster + betalade fastighetsuppslag om ni har)
set_secret LANTMATERIET_OPEN_SUBSCRIPTION_KEY "din-open-data-nyckel"
set_secret LANTMATERIET_CONSUMER_KEY "din-consumer-key"
set_secret LANTMATERIET_CONSUMER_SECRET "din-consumer-secret"

# Vertex AI behöver inga separata secrets — service account räcker.
# Men om ni vill förbigå service account via keyfile:
# set_secret GOOGLE_APPLICATION_CREDENTIALS_JSON "$(cat sa-keyfile.json)"

# SLU Artdatabanken
set_secret SLU_API_KEY "din-slu-nyckel"

# Outlook Graph (valfritt)
set_secret OUTLOOK_GRAPH_TENANT_ID "..."
set_secret OUTLOOK_GRAPH_CLIENT_ID "..."
set_secret OUTLOOK_GRAPH_CLIENT_SECRET "..."
set_secret OUTLOOK_GRAPH_USER "registrator@miljobeslut.se"

# BankID (enda tillåtna mock-vägen)
set_secret BANKID_BASE_URL "https://appapi2.bankid.com/rp/v6.0"
# Certifikat: ladda upp som binär Secret (version tar --data-file):
# gcloud secrets create BANKID_PFX --replication-policy=automatic
# gcloud secrets versions add BANKID_PFX --data-file=bankid.pfx
```

Ge Cloud Run-SA access till varje secret (alternativt ge `secretAccessor`-rollen
på projektnivå, vilket redan gjordes i Steg 5).

## Steg 7 — Cloud Run Job för migrations

Detta jobb körs av Cloud Build före varje deploy för att applicera Prisma-
migrationer och PostGIS-bootstrap.

```bash
gcloud run jobs create miljobeslut-migrate \
  --region=$REGION \
  --image=$REGION-docker.pkg.dev/$PROJECT_ID/miljobeslut/miljobeslut:latest \
  --command=/bin/sh \
  --args='-c','npx prisma migrate deploy && npx tsx scripts/db/spatial-bootstrap.ts' \
  --service-account=$RUNTIME_SA \
  --set-cloudsql-instances=$PROJECT_ID:$REGION:miljobeslut-db \
  --vpc-connector=miljobeslut-vpc \
  --set-secrets=DATABASE_URL=DATABASE_URL:latest
```

## Steg 8 — Deploy via Cloud Build

Första deployen (lokal push) — därefter triggas via GitHub push-events:

```bash
gcloud builds submit \
  --config=cloudbuild.yaml \
  --substitutions=_REGION=$REGION,_SERVICE=miljobeslut,_REPO=miljobeslut,_CLOUDSQL=$PROJECT_ID:$REGION:miljobeslut-db,_VPC_CONNECTOR=miljobeslut-vpc
```

Den första deployen saknar dock env-variabler. Kör omgående:

```bash
gcloud run services update miljobeslut --region=$REGION \
  --service-account=$RUNTIME_SA \
  --set-env-vars=NODE_ENV=production,VERTEX_PROJECT_ID=$PROJECT_ID,VERTEX_LOCATION=$REGION,VERTEX_TEXT_MODEL=gemini-1.5-pro,VERTEX_FAST_MODEL=gemini-1.5-flash,PROPERTY_LOOKUP_MODE=hybrid,DOMSTOL_RSS_ENABLED=true \
  --set-secrets=DATABASE_URL=DATABASE_URL:latest,JWT_ACCESS_SECRET=JWT_ACCESS_SECRET:latest,JWT_REFRESH_SECRET=JWT_REFRESH_SECRET:latest,SEARCH_ENCRYPTION_KEY_BASE64=SEARCH_ENCRYPTION_KEY_BASE64:latest,LANTMATERIET_OPEN_SUBSCRIPTION_KEY=LANTMATERIET_OPEN_SUBSCRIPTION_KEY:latest,LANTMATERIET_CONSUMER_KEY=LANTMATERIET_CONSUMER_KEY:latest,LANTMATERIET_CONSUMER_SECRET=LANTMATERIET_CONSUMER_SECRET:latest,SLU_API_KEY=SLU_API_KEY:latest
```

## Steg 9 — Automatisk CI/CD via GitHub

Koppla repo till Cloud Build triggers:

```bash
gcloud builds triggers create github \
  --name=miljobeslut-main \
  --repo-name=Miljobeslut \
  --repo-owner=DIN-GH-ORG \
  --branch-pattern="^main$" \
  --build-config=Miljöbeslut.se/cloudbuild.yaml \
  --include-logs-with-status
```

Varje push till `main` bygger ny image, kör migrations, och rollar ut ny
Cloud Run-revision.

## Steg 10 — Domän + HTTPS

```bash
gcloud run domain-mappings create \
  --service=miljobeslut \
  --domain=miljobeslut.se \
  --region=$REGION
```

Lägg DNS-records (A/AAAA) som Cloud Run instruerar.

## Steg 11 — Observability

- **Cloud Logging:** `gcloud logging tail "resource.type=cloud_run_revision AND resource.labels.service_name=miljobeslut"`
- **Liveness:** `curl https://miljobeslut-xxx.a.run.app/health` (ingen DB-query)
- **Readiness:** `curl https://miljobeslut-xxx.a.run.app/ready` (DB + integrationsstatus; använd för uptime/lastbalansering)
- **Cloud Monitoring:** rekommenderat intervall mot **`/ready`** (60s) för trafik; `/health` om ni bara vill övervaka processen. Se [GCP_P2_PLATFORM.md](GCP_P2_PLATFORM.md).
- **Error tracking:** Sentry-SDK finns redan; lägg `SENTRY_DSN` som secret om ni vill ha error-aggregering utanför Cloud Logging.

## Steg 12 — Cloud Storage för Outlook-attachments

```bash
gcloud storage buckets create gs://$PROJECT_ID-attachments \
  --location=$REGION \
  --uniform-bucket-level-access \
  --public-access-prevention

gcloud storage buckets add-iam-policy-binding gs://$PROJECT_ID-attachments \
  --member="serviceAccount:$RUNTIME_SA" \
  --role=roles/storage.objectUser

# Lägg till env-var OUTLOOK_STORAGE_ROOT=gs://.../outlook
gcloud run services update miljobeslut --region=$REGION \
  --update-env-vars=OUTLOOK_STORAGE_ROOT=gs://$PROJECT_ID-attachments/outlook
```

> Nuvarande kod skriver till lokal filväg. För Cloud Run krävs en anpassning
> i `outlookIngestionService` att skriva via `@google-cloud/storage` när URI
> börjar med `gs://`. Dokumenterat i backlog.

## Kostnadsbild (ungefärlig, 2026-04)

| Komponent                         | Typisk kostnad/månad | Kommentar                               |
| --------------------------------- | -------------------- | --------------------------------------- |
| Cloud Run (1 min-inst + 0–10 max) | 25–60 USD            | Skalar ned när trafik saknas            |
| Cloud SQL db-custom-2-4096        | ~100 USD             | 2 vCPU + 4 GB RAM, 20 GB SSD            |
| VPC connector                     | ~5 USD               | 2 min-inst                              |
| Vertex AI (Gemini)                | Per request          | gemini-1.5-flash ~0.07 USD/1M input-tok |
| Artifact Registry                 | ~1 USD               | Image-lagring                           |
| Secret Manager                    | Försumbart           | 6 cent / 10 000 operationer             |
| Cloud Storage                     | ~2–5 USD             | Per 100 GB, klass standard              |
| **Totalt pilot**                  | **~140–180 USD/mån** | Innan stor trafik                       |

## Regel om mockar (oförändrad)

Endast `BANKID_MOCK_MODE=true` får vara aktiverat i produktion. Alla andra
integrationer kör live. Smoketest `npm run smoke:integrations` flaggar
MISSING för integrationer utan credentials.

## Felsökning

| Symptom                                                 | Åtgärd                                                                                                              |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Cloud Run start crash: `PrismaClient failed to connect` | Verifiera `--set-cloudsql-instances` + `--vpc-connector` flaggor + att `DATABASE_URL` använder `host=/cloudsql/...` |
| Vertex AI 403: `permission denied`                      | Service account saknar `roles/aiplatform.user`. Lägg till med `gcloud projects add-iam-policy-binding`.             |
| `/ready` returnerar 503                                 | Databas otillgänglig — kolla Cloud Logging, Cloud SQL, VPC-connector, `DATABASE_URL` (socket `/cloudsql/...`).  |
| `/health` svarar alltid 200 om processen lever          | För förväntad DB-status, använd `/ready` i stället. |
| WebSocket disconnect efter 60s                          | Sätt `--session-affinity` + `--timeout=3600` på Cloud Run-tjänsten.                                                 |
| Lantmäteriet OGC returnerar 401                         | `LANTMATERIET_OPEN_SUBSCRIPTION_KEY` saknar access till produkten. Godkänn den i API-portalen.                      |
| Scheduler (domstol-RSS) kör inte                        | Kontrollera `--min-instances=1` på Cloud Run — utan detta stoppas processen mellan requests.                        |

## GitHub Actions-alternativ (om ni inte vill använda Cloud Build-trigger)

```yaml
name: Deploy to Cloud Run
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write
    steps:
      - uses: actions/checkout@v4
      - uses: google-github-actions/auth@v2
        with:
          workload_identity_provider: projects/NUM/locations/global/workloadIdentityPools/gh/providers/main
          service_account: ci-deployer@PROJECT.iam.gserviceaccount.com
      - uses: google-github-actions/setup-gcloud@v2
      - run: |
          gcloud builds submit --config cloudbuild.yaml \
            --substitutions=_REGION=europe-west1,_SERVICE=miljobeslut,_REPO=miljobeslut,_CLOUDSQL=$PROJECT_ID:europe-west1:miljobeslut-db,_VPC_CONNECTOR=miljobeslut-vpc
```

## Sammanfattning

Med denna setup är hela plattformen i Googles ekosystem — en leverantör,
inget extern beroende förutom BankID/Lantmäteriet. Vertex AI ersätter Gemini
direct + OpenAI. Cloud Run hanterar både app och scheduler. Cloud SQL kör
PostGIS natively. Secret Manager bär alla credentials.
