# Lokal prod — egen server (primär drift)

**Beslut:** Alternativ A (dual-track). Denna miljö är **primär prod**; GCP Cloud Run är pilot.

Relaterat: [local-first-gcp-optional.md](local-first-gcp-optional.md), [postgis-docker-drift.md](postgis-docker-drift.md).

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

# 4. Verifiera
curl http://localhost:3000/health
curl http://localhost:3000/ready
```

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

## GCP pilot (parallell)

- Auto-deploy till Cloud Run är **av** (`GCP_DEPLOY_ENABLED=false`)
- Manuell GCP-deploy: GitHub Actions → Deploy – Google Cloud Run
- Synka hemligheter till Secret Manager vid behov: `scripts/gcp/sync-secrets-from-env.ps1`

---

## Felsökning

| Symptom | Åtgärd |
|---------|--------|
| `/ready` database error | Kör `prisma migrate deploy`; kontrollera `DATABASE_URL` |
| Saknar geo-data | Kontrollera `IMPORT_ARCHIVE_ROOT` mount och harvesting-manifest |
| Vertex fel | `gcloud auth application-default login` eller service account JSON |
