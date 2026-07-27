# Lokal prod — egen server (primär drift)

**Beslut:** Alternativ A (dual-track). **Primär prod** = egen server. GCP = staging/pilot/demo.

Full spec: [dual-track-a.md](dual-track-a.md) · Fas 1: [local-prod-fas1.md](local-prod-fas1.md) · Relaterat: [local-first-gcp-optional.md](local-first-gcp-optional.md)

---

## Förutsättningar

- Docker Desktop (Windows) eller Docker Engine (Linux)
- Master Archive tillgängligt (canonical path enligt Mimers Brunn)
- `.env.production` skapad från [`.env.production.example`](../../.env.production.example) (filen committas **inte**)

---

## Snabbstart

```powershell
# 1. Miljöfil
Copy-Item .env.production.example .env.production
# Redigera .env.production — sätt JWT, API-nycklar, archive paths

# 2. Bygg och starta
docker compose -f docker-compose.prod.yml up -d --build

# 3. Schema + PostGIS (första gången eller efter migrate)
docker compose -f docker-compose.prod.yml exec app npx prisma migrate deploy
docker compose -f docker-compose.prod.yml exec app npx tsx scripts/db/spatial-bootstrap.ts

# 4. Verifiera (app på 8080 om port 3000 upptagen av Vite dev)
curl http://localhost:8080/health
curl http://localhost:8080/ready
```

Operativa scripts (backup, JWT-rotering, verify): [scripts/ops/README.md](../../scripts/ops/README.md) · [local-prod-fas1.md](local-prod-fas1.md)

---

## Arkiv och geo (Mimers Brunn)

Montera Master Archive read-only i compose (justera path):

```yaml
volumes:
  - "H:/Delade enheter/Miljöbeslut/GEO_Master_Archive:/data/geo_master:ro"
```

Sätt i `.env.production`:

```env
IMPORT_ARCHIVE_ROOT=/data/geo_master
KNOWLEDGE_BASE_ROOT=/data/geo_master/knowledge_base
```

Importera **inte** från `_review` eller temporära mappar.

---

## Workers och cron

Lokal prod kör workers **in-process** (ingen Cloud Scheduler):

```env
SEARCH_WORKER_ENABLED=true
GDPR_CRON_IN_PROCESS=true
START_WORKERS_IN_PROCESS=true
```

---

## GCP pilot (parallell — inte primär prod)

- **main** triggar **inte** GCP-deploy
- Auto-deploy till Cloud Run: endast **`staging`-branch** + `STAGING_DEPLOY_ENABLED=true` (default: av)
- Manuell pilot-deploy: GitHub Actions → Deploy – Google Cloud Run → `workflow_dispatch`
- Synka hemligheter till Secret Manager vid behov: `scripts/gcp/sync-secrets-from-env.ps1 -SkipDatabaseUrl`
- Audit enligt policy: `scripts/gcp/audit-secrets.ps1` (LM = consumer key+secret; Trafikverket token lokalt vid behov; OpenAI/BankID ignoreras)

---

## Felsökning

| Symptom | Åtgärd |
|---------|--------|
| `/ready` database error | Kör `prisma migrate deploy`; kontrollera `DATABASE_URL` |
| `extension "vector" is not available` | Bygg om db-image (`docker compose -f docker-compose.prod.yml build db`); prod-Postgres inkluderar pgvector via `docker/postgres-prod` |
| Port 3000 upptagen | Prod-app lyssnar på **8080**; Postgres på **5434** (se `docker-compose.prod.yml`) |
| Saknar geo-data | Kontrollera `IMPORT_ARCHIVE_ROOT` mount och harvesting-manifest |
| Vertex fel | `gcloud auth application-default login` eller service account JSON |
