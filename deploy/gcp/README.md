# Driftsättning – Google Cloud Run

Denna guide beskriver hur Miljobeslut.se driftsätts på Google Cloud med
**Cloud Run** (serverless containers), **Cloud SQL for PostgreSQL** (PostGIS + pgvector)
och **Secret Manager** för hemligheter.

## Arkitekturöversikt

```
GitHub Actions / Cloud Build
        │
        ▼
Artifact Registry          Secret Manager
(Docker-image)             (alla hemligheter)
        │                         │
        ▼                         ▼
Cloud Run Service  ◄──────── IAM Service Account
        │
        ▼ (Unix-socket via /cloudsql/...)
Cloud SQL for PostgreSQL 15
(PostGIS 3.3 + pgvector)
```

## Förutsättningar

- `gcloud` CLI installerat och konfigurerat (`gcloud auth login`)
- GCP-projekt skapat med fakturering aktiverat
- Roller: `Owner` eller `Editor` + specifika roller nedan

---

## Steg 1 – Aktivera API:er

```bash
PROJECT_ID=ditt-projekt-id
gcloud config set project $PROJECT_ID

gcloud services enable \
  run.googleapis.com \
  sqladmin.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  secretmanager.googleapis.com \
  cloudresourcemanager.googleapis.com
```

---

## Steg 2 – Skapa Artifact Registry

```bash
gcloud artifacts repositories create miljobeslut \
  --repository-format=docker \
  --location=europe-west1 \
  --description="Miljobeslut.se Docker images"
```

---

## Steg 3 – Skapa Cloud SQL (PostgreSQL 15 + PostGIS + pgvector)

```bash
# Skapa instansen (db-f1-micro räcker för staging/Core)
gcloud sql instances create miljobeslut-db \
  --database-version=POSTGRES_15 \
  --tier=db-f1-micro \
  --region=europe-west1 \
  --storage-type=SSD \
  --storage-size=10GB \
  --backup-start-time=03:00 \
  --availability-type=zonal \
  --database-flags=cloudsql.enable_pgvector=on

# Skapa databas och användare
gcloud sql databases create miljobeslut_prod --instance=miljobeslut-db
# Sätt lösenord säkert utan att exponera det i shell-historiken
read -s -p "Ange databaslösenord: " DB_PASS && echo
gcloud sql users create miljobeslut --instance=miljobeslut-db --password="$DB_PASS"

# Aktivera PostGIS och pgvector (kör en gång via Cloud SQL Studio eller psql)
# CREATE EXTENSION IF NOT EXISTS postgis;
# CREATE EXTENSION IF NOT EXISTS vector;
```

> **Tips:** Cloud SQL connection name används i `DATABASE_URL` och `cloud-run-service.yaml`.
> Hämta den med: `gcloud sql instances describe miljobeslut-db --format='value(connectionName)'`

---

## Steg 4 – Lägg hemligheter i Secret Manager

```bash
# Skapa DATABASE_URL med Cloud SQL Unix-socket
# Läs lösenordet säkert från stdin för att undvika shell-historik
read -s -p "Databaslösenord: " DB_PASS && echo
printf "postgresql://miljobeslut:%s@localhost/miljobeslut_prod?host=/cloudsql/%s:europe-west1:miljobeslut-db" \
  "$DB_PASS" "$PROJECT_ID" \
  | gcloud secrets create DATABASE_URL --data-file=-

# JWT-hemligheter (generera med: openssl rand -hex 64)
echo -n "DITT_JWT_ACCESS_SECRET"  | gcloud secrets create JWT_ACCESS_SECRET --data-file=-
echo -n "DITT_JWT_REFRESH_SECRET" | gcloud secrets create JWT_REFRESH_SECRET --data-file=-

# AI-nycklar
echo -n "GEMINI_API_KEY_VÄRDE"    | gcloud secrets create GEMINI_API_KEY --data-file=-
echo -n "OPENAI_API_KEY_VÄRDE"    | gcloud secrets create OPENAI_API_KEY --data-file=-

# Lantmäteriet, SLU, BankID
echo -n "LANTMATERIET_KEY"        | gcloud secrets create LANTMATERIET_API_KEY --data-file=-
echo -n "SLU_KEY"                 | gcloud secrets create SLU_API_KEY --data-file=-
echo -n "BANKID_PFX_PASSPHRASE"   | gcloud secrets create BANKID_PFX_PASSPHRASE --data-file=-

# Sök-krypteringsnyckel
echo -n "BASE64_NYCKEL"           | gcloud secrets create SEARCH_ENCRYPTION_KEY_BASE64 --data-file=-

# Admin-lösenord
echo -n "ADMIN_LÖSENORD"          | gcloud secrets create ADMIN_CONSOLE_PASSWORD --data-file=-
```

---

## Steg 5 – Skapa service account med minsta behörighet

```bash
gcloud iam service-accounts create miljobeslut-sa \
  --display-name="Miljöbeslut Cloud Run SA"

SA="miljobeslut-sa@$PROJECT_ID.iam.gserviceaccount.com"

# Cloud SQL Client (ansluta via socket)
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:$SA" --role="roles/cloudsql.client"

# Secret Manager Secret Accessor (läsa hemligheter)
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:$SA" --role="roles/secretmanager.secretAccessor"

# Artifact Registry Reader (hämta Docker-image)
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:$SA" --role="roles/artifactregistry.reader"
```

---

## Steg 6 – Uppdatera cloud-run-service.yaml

Ersätt `PROJECT_ID` i `deploy/gcp/cloud-run-service.yaml` med ditt faktiska projekt-ID:

```bash
sed -i "s/PROJECT_ID/$PROJECT_ID/g" deploy/gcp/cloud-run-service.yaml
```

---

## Steg 7 – Bygg och pusha Docker-image manuellt (första gången)

```bash
# Autentisera Docker mot Artifact Registry
gcloud auth configure-docker europe-west1-docker.pkg.dev

# Bygg och pusha
docker build --target production \
  -t europe-west1-docker.pkg.dev/$PROJECT_ID/miljobeslut/miljobeslut:latest .

docker push europe-west1-docker.pkg.dev/$PROJECT_ID/miljobeslut/miljobeslut:latest
```

---

## Steg 8 – Deploya Cloud Run service

```bash
# Kör Prisma migrate mot Cloud SQL (med Cloud SQL Auth Proxy lokalt eller via cloudbuild)
DATABASE_URL="postgresql://miljobeslut:LÖSENORD@localhost/miljobeslut_prod?host=/cloudsql/$PROJECT_ID:europe-west1:miljobeslut-db" \
  npx prisma migrate deploy

# Deploya service
gcloud run services replace deploy/gcp/cloud-run-service.yaml --region=europe-west1

# Ge publik åtkomst (om applikationen är publik)
gcloud run services add-iam-policy-binding miljobeslut \
  --region=europe-west1 \
  --member="allUsers" \
  --role="roles/run.invoker"
```

---

## Steg 9 – Konfigurera CI/CD (GitHub Actions)

1. Skapa ett service account för CI:

```bash
gcloud iam service-accounts create github-ci-sa \
  --display-name="GitHub Actions CI/CD"

CI_SA="github-ci-sa@$PROJECT_ID.iam.gserviceaccount.com"

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:$CI_SA" --role="roles/run.admin"
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:$CI_SA" --role="roles/storage.admin"
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:$CI_SA" --role="roles/artifactregistry.admin"
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:$CI_SA" --role="roles/iam.serviceAccountUser"
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:$CI_SA" --role="roles/secretmanager.secretAccessor"
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:$CI_SA" --role="roles/cloudsql.client"
```

2. Aktivera Workload Identity Federation (rekommenderat – ingen JSON-nyckel):

```bash
gcloud iam workload-identity-pools create github-pool \
  --location=global --display-name="GitHub Actions Pool"

gcloud iam workload-identity-pools providers create-oidc github-provider \
  --location=global \
  --workload-identity-pool=github-pool \
  --display-name="GitHub provider" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
  --issuer-uri="https://token.actions.githubusercontent.com"

POOL_ID=$(gcloud iam workload-identity-pools describe github-pool \
  --location=global --format="value(name)")

gcloud iam service-accounts add-iam-policy-binding $CI_SA \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/$POOL_ID/attribute.repository/JbmbAb/Milj-beslut-V1.2"
```

3. Sätt GitHub-secrets (i repository Settings → Secrets):
   - `GCP_PROJECT_ID` – ditt projekt-ID
   - `GCP_WORKLOAD_IDENTITY_PROVIDER` – `$POOL_ID/providers/github-provider`
   - `GCP_SERVICE_ACCOUNT` – `$CI_SA` (Cloud Run deploy)
   - `GCP_VERTEX_SERVICE_ACCOUNT` – `alpha-evolve-client@miljointelligens.iam.gserviceaccount.com` (Vertex / prompt optimizer)
   - `GCP_CLOUDSQL_INSTANCE` – `$PROJECT_ID:europe-west1:miljobeslut-db`
   - `GCP_REGION` – `europe-west1` (eller som variabel)

4. Verifiera Vertex-anslutning via WIF (ingen JSON-nyckel):

```bash
gh workflow run vertex-wif-smoke.yml -R JbmbAb/Milj-beslut-V1.2
```

Miljöbeslut använder composite action `.github/actions/gcp-wif-auth` i Vertex-workflows.

---

## Health check

Cloud Run och GitHub Actions kör hälsokontroll mot:

```
GET /api/health
```

Endpointen returnerar Tier 1–3 readiness (kod, DB, externa API:er).
Returnerar HTTP 200 så länge Tier 1 (kodkvalitet) är OK.

---

## Vanliga missförstånd

| Felaktigt | Rätt |
| --------- | ---- |
| `git init` + nytt repo | Repot **finns redan** — `git clone` eller använd befintlig klon |
| Push till `JbmbAb/milj-beslut` | Endast **`JbmbAb/Milj-beslut-V1.2`** |
| `.github/workflows/deploy.yml` | **`deploy-gcp.yml`** (Cloud Run) + **`vertex-wif-smoke.yml`** (Vertex-test) |
| JSON-nyckel `GCP_SA_KEY` i CI | **WIF:** `GCP_WORKLOAD_IDENTITY_PROVIDER` + `GCP_VERTEX_SERVICE_ACCOUNT` |
| Separat mapp `Milj-beslut-V1.2` måste skapas | Lokalt mappnamn spelar ingen roll (`miljöbeslut` är OK) |

Verifiera Vertex-anslutning:

```bash
gh workflow run vertex-wif-smoke.yml -R JbmbAb/Milj-beslut-V1.2
```

---

## Vanliga problem

| Problem                            | Lösning                                                                                 |
| ---------------------------------- | --------------------------------------------------------------------------------------- |
| `connection refused` mot DB        | Kontrollera `--add-cloudsql-instances` och att `DATABASE_URL` har `?host=/cloudsql/...` |
| `permission denied` Secret Manager | Ge `roles/secretmanager.secretAccessor` till Cloud Run SA                               |
| Prisma generate misslyckas         | Kontrollera att `openssl` finns i base-image (finns i nuvarande Dockerfile)             |
| pgvector saknas                    | Kör `CREATE EXTENSION IF NOT EXISTS vector;` en gång mot Cloud SQL-instansen            |
| Cold-start > 10s                   | Öka `initialDelaySeconds` i `startupProbe` eller sätt `minScale: "1"`                   |
