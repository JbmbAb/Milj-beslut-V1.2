# Dedicated-server staging prep (PNRC I2)

Provider-neutral staging stack per [provider-neutral-runtime-contract-v0.1.md](../../docs/ops/provider-neutral-runtime-contract-v0.1.md).

## Storage authorities

| ID | Mount / volume | Role |
|----|----------------|------|
| A | `document_storage` → `/app/storage/uploads` | Document/object uploads |
| B | `mimers_cas` → `/var/mimers/cas` | Mimers canonical CAS |
| C | `${IMPORT_ARCHIVE_HOST_PATH}` → `/data/geo_master:ro` | Master/source archive |
| D | `pgdata_staging` | PostgreSQL 15 + PostGIS projection |

## Quick start

```powershell
Copy-Item .env.staging.example .env.staging
New-Item -ItemType Directory -Force deploy/staging/secrets
Copy-Item deploy/staging/secrets.example/* deploy/staging/secrets/
# Edit deploy/staging/secrets/* locally — never commit

docker compose -f docker-compose.staging.yml --env-file .env.staging up -d --build
docker compose -f docker-compose.staging.yml exec web npx prisma migrate deploy
docker compose -f docker-compose.staging.yml exec web npx tsx scripts/db/spatial-bootstrap.ts
pwsh scripts/ops/verify-prod.ps1 -ComposeFile docker-compose.staging.yml
```

## Worker isolation

- `web`: `START_WORKERS_IN_PROCESS=false` — no LU signer keys
- `worker`: `target: worker-all` — LU provisioning and signer material

## TLS / edge

Terminate TLS at Caddy/nginx in front of port 8080. IP allowlist/VPN optional; never replaces application auth.

## LEGACY_GCP

Cloud Run IAM harness files remain under `release-harness/staging/` with `LEGACY_GCP` headers for audit only.
