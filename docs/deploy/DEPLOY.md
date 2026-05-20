# Deploy-guide — Miljöbeslut

Denna guide täcker hur Miljöbeslut sätts upp i molnet. **Vercel används INTE**
eftersom plattformen är en fullstack-app med långlevande processer
(WebSocket, RSS-scheduler, search-worker, Outlook-ingest) och PostGIS-databas —
Vercel Serverless dödar processer mellan requests.

Primär rekommendation: **Fly.io + managed PostgreSQL med PostGIS**.
Alternativ: **Railway + Neon/Supabase**, **Azure App Service + Azure Database for
PostgreSQL**, eller egen Kubernetes-kluster med Docker-imagen.

## Arkitekturöverblick

```
┌───────────────────────────────────────────────────┐
│ Fly.io app: miljobeslut                           │
│ ┌─────────────────────────────────────────────┐   │
│ │ Dockerfile.fly (node:22-alpine)             │   │
│ │  - Express + WebSocket (port 8080)          │   │
│ │  - Vite-byggd SPA i dist/                   │   │
│ │  - Scheduler: domstol-RSS, Outlook Graph,   │   │
│ │    search-worker, municipality polling      │   │
│ │  - tsx som runtime (ingen tsc-build)        │   │
│ └─────────────────────────────────────────────┘   │
└─────────────────┬─────────────────────────────────┘
                  │
                  ▼
┌───────────────────────────────────────────────────┐
│ Managed PostgreSQL med PostGIS                    │
│  - Supabase (gratis PostGIS-tillägg)              │
│  - Neon (PostGIS preview)                         │
│  - Azure Database for PostgreSQL Flexible Server  │
│  - Fly.io Postgres (PostGIS-image)                │
└───────────────────────────────────────────────────┘
```

## Steg 1 — Välj Postgres-leverantör

| Leverantör                        | PostGIS                    | GIS-import       | Kommentar                                           |
| --------------------------------- | -------------------------- | ---------------- | --------------------------------------------------- |
| **Supabase**                      | Ja (default)               | `psql`-stöd      | Enklast. Inbyggt pgvector, pg_trgm, unaccent.       |
| **Neon**                          | Ja (via extensions)        | `psql`           | Serverless, autosuspend — passar lätt trafik.       |
| **Fly.io Postgres**               | Ja (postgis/postgis-image) | `fly pg connect` | Bra om app och DB körs i samma region.              |
| **Azure Database for PostgreSQL** | Ja                         | psql / Azure CLI | Bäst om ni redan är i Azure/Office 365-ekosystemet. |

Skapa databas och notera `DATABASE_URL` (format `postgresql://user:pass@host:port/dbname`).

## Steg 2 — Installera Fly CLI och skapa app

```bash
# macOS/Linux
curl -L https://fly.io/install.sh | sh
# Windows
iwr https://fly.io/install.ps1 -useb | iex

fly auth login
cd Miljöbeslut.se
fly launch --no-deploy --name miljobeslut --region arn --copy-config
```

## Steg 3 — Sätt secrets

**Obligatoriskt (annars startar servern inte):**

```bash
fly secrets set \
  DATABASE_URL="postgresql://user:pass@db.example.com:5432/miljobeslut" \
  JWT_ACCESS_SECRET="$(openssl rand -hex 32)" \
  JWT_REFRESH_SECRET="$(openssl rand -hex 32)" \
  SEARCH_ENCRYPTION_KEY_BASE64="$(openssl rand -base64 32)"
```

**För skarpa integrationer (inget får mockas utom BankID):**

```bash
fly secrets set \
  LANTMATERIET_CONSUMER_KEY="..." \
  LANTMATERIET_CONSUMER_SECRET="..." \
  LANTMATERIET_BASE_URL="https://api.lantmateriet.se/ogc-features/v1" \
  GEMINI_API_KEY="..." \
  SLU_API_KEY="..." \
  SMHI_PMP3G_BASE_URL="https://opendata-download-metfcst.smhi.se"
```

**För Outlook Graph-ingest:**

```bash
fly secrets set \
  OUTLOOK_GRAPH_TENANT_ID="..." \
  OUTLOOK_GRAPH_CLIENT_ID="..." \
  OUTLOOK_GRAPH_CLIENT_SECRET="..." \
  OUTLOOK_GRAPH_USER="registrator@miljobeslut.se"
```

**BankID (enda tillåtna mock-vägen):**

```bash
# Production med cert
fly secrets set \
  BANKID_BASE_URL="https://appapi2.bankid.com/rp/v6.0" \
  BANKID_PFX_PATH="/app/certs/bankid.pfx" \
  BANKID_PFX_PASSPHRASE="..."
# Dev/test mock
fly secrets set BANKID_MOCK_MODE="true"
```

## Steg 4 — Initiera databasen

Prisma-migrations + PostGIS-bootstrap körs automatiskt via `release_command`
i `fly.toml`, men om du vill köra manuellt:

```bash
# Migrations
fly ssh console -C "npx prisma migrate deploy"

# PostGIS extensions + prisma/spatial/*.sql
fly ssh console -C "npx tsx scripts/db/spatial-bootstrap.ts"
```

## Steg 5 — Deploy

```bash
fly deploy --dockerfile Dockerfile.fly
```

Första deployen tar ~5–8 minuter. Efter deploy:

```bash
fly status
fly logs
curl https://miljobeslut.fly.dev/health
```

Förväntat health-svar:

```json
{ "ok": true, "service": "miljobeslut-secure-backend", "db": "ok", "ts": "..." }
```

## Steg 6 — Funktionskontroll i produktion

Kör smoketester mot live-endpoint:

```bash
BASE_URL=https://miljobeslut.fly.dev npm run smoke:map-layers
BASE_URL=https://miljobeslut.fly.dev npm run smoke:legal-sort
DATABASE_URL="..." npm run smoke:postgis
npm run smoke:integrations  # körs mot lokala env-vars
```

## Steg 7 — Domän + HTTPS

```bash
fly certs add miljobeslut.se
fly certs add www.miljobeslut.se
```

Lägg till DNS-records som Fly instruerar (A/AAAA + CNAME).

## Alternativ: Railway + Supabase

Railway har enklare UI men saknar volumes för Outlook-bilagor. Passar bra för
ren app-tier + extern blob storage (S3/Backblaze B2).

1. `railway login && railway init`
2. Koppla Dockerfile.fly (byt `CMD` vid behov).
3. Skapa Supabase-projekt med PostGIS.
4. Lägg Supabase DATABASE_URL som Railway-variabel.
5. Sätt resten av secrets i Railway UI eller `railway variables set`.

## Regel om mockar i produktion

**Hård regel (2026-04):** Endast `BANKID_MOCK_MODE=true` får vara aktiverat i
produktion. Alla andra integrationer ska köra live — annars fallar
deploy-verifieringen (smoketest `npm run smoke:integrations` flaggar MISSING).

Specifika spärrar:

- `LANTMATERIET_DEMO_MODE` är avvecklad (togs bort i spår 7a).
- `AUTHORITY_MOCK_MODE` spärrad automatiskt när `NODE_ENV=production`.
- `SEWAGE_GIS_LIVE_ENABLED`-flaggan är borttagen (spår 7c).
- `geminiService.ts` kastar istället för att returnera offline-strängar.
- `marketIntelService.ts` returnerar `not_configured` + tom data istället för
  statiska priser.

## Kontinuerlig deploy (GitHub Actions)

Lägg till i `.github/workflows/`:

```yaml
name: Deploy to Fly.io
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: superfly/flyctl-actions/setup-flyctl@master
      - run: flyctl deploy --remote-only --dockerfile Dockerfile.fly
        env:
          FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}
```

Skapa token via `fly tokens create deploy -x 999999h`.

## Felsökning

| Symptom                           | Åtgärd                                                                       |
| --------------------------------- | ---------------------------------------------------------------------------- |
| `/health` returnerar 503 db=error | Kolla `DATABASE_URL` med `fly secrets list` + att PostGIS är aktiverat.      |
| WebSocket försvinner efter 60s    | `min_machines_running = 1` i `fly.toml` + auto_stop avstängd.                |
| Prisma-fel vid start              | Kör `fly ssh console -C "npx prisma generate"` och re-deploy.                |
| Kartlager returnerar 500          | Kör `npm run smoke:postgis` — kontrollera att `env.protected_area` är fylld. |
| Outlook-scheduler tyst            | `OUTLOOK_GRAPH_*`-secrets saknas, eller Mail.Read-permission inte beviljad.  |
