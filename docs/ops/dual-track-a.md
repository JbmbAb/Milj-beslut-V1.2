# Dual-track A — lokal prod primär, GCP pilot

**Status:** Aktivt beslut (2026-07-27). Exit-strategi och Mimers Brunn-policy **oförändrade**.

---

## Modell

| Spår | Roll | Innehåll |
|------|------|----------|
| **Lokal (primär prod)** | Riktig produktion | Master Archive, PostGIS, beslutslogik, domänlogik, Evolver-kärnan, workers in-process |
| **GCP (staging/pilot)** | Demo, Vertex-smoke, CI-validering | Cloud Run, Cloud SQL, Secret Manager, Vertex-jobb — **ingen** bulk geo/data |

**Uttryckligen inte i scope:**

- Ingen datamigrering till molnet
- Ingen ändring av arkitekturpolicy (Mimers Brunn, offline-first)
- Master Archive stannar lokalt (`GEO_Master_Archive`)

---

## Deploy-regler (GitHub Actions)

| Trigger | Villkor | Mål |
|---------|---------|-----|
| `workflow_dispatch` | Alltid (manuell) | Välj `staging` eller `production` (pilot) |
| CI på **`staging`-branch** | `STAGING_DEPLOY_ENABLED=true` | Cloud Run staging |
| CI på **`main`** | **Deployeras inte** till GCP | — |

Repo-variabler:

| Variabel | Rekommenderat | Syfte |
|----------|---------------|--------|
| `STAGING_DEPLOY_ENABLED` | `false` | Auto-deploy GCP efter CI på `staging` |
| `GCP_SERVICE_URL` | (satt av workflow) | Pilot-URL för smoke |

Legacy `GCP_DEPLOY_ENABLED` används **inte** längre — ersatt av `STAGING_DEPLOY_ENABLED` + branch-gate.

---

## Hemligheter och integrationer

| Integration | Policy |
|-------------|--------|
| Lantmäteriet | OAuth2: `CONSUMER_KEY` + `CONSUMER_SECRET` |
| Trafikverket | Token **lokal valfri** i `.env.production`; mock tills token finns |
| OpenAI | Ej aktuell |
| BankID | Uppskjuten |
| Vertex | Gemensam molntjänst (lokal ADC/Gemini + GCP runtime SA) |

Synk till GCP pilot: `pwsh scripts/gcp/sync-secrets-from-env.ps1 -SkipDatabaseUrl`  
Audit: `pwsh scripts/gcp/audit-secrets.ps1`

---

## Snabbstart lokal prod

Se [local-prod-setup.md](local-prod-setup.md) och **Fas 1-hårdning:** [local-prod-fas1.md](local-prod-fas1.md)

```powershell
docker compose -f docker-compose.prod.yml up -d --build
# http://localhost:8080
pwsh scripts/ops/verify-prod.ps1
```

GCP pilot (manuellt): GitHub Actions → **Deploy – Google Cloud Run** → Run workflow.

---

## Relaterade dokument

- [local-prod-setup.md](local-prod-setup.md) — primär drift
- [local-first-gcp-optional.md](local-first-gcp-optional.md) — arkitektur och env-profiler
- [deploy/gcp/README.md](../../deploy/gcp/README.md) — Cloud Run bootstrap
- [AGENTS.md](../../AGENTS.md) — Mimers Brunn, human-in-the-loop
