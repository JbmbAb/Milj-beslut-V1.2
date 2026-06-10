# P3 staging E2E — bevislogg (2026-06-09)

Uppdatering efter plattformsanalys och stop-the-line-fixar (deploy, säkerhet, Mimers Brunn).

## Miljövariabler som krävs för grön staging-körning

| Variabel | Syfte |
|----------|--------|
| `PLAYWRIGHT_BASE_URL` | Staging UI (t.ex. `https://staging.miljobeslut.se`) |
| `PLAYWRIGHT_API_BASE_URL` | Staging API |
| `STAGING_ADMIN_USERNAME` / `STAGING_ADMIN_PASSWORD` | Admin-session (P3 utan BankID) |
| `VERTEX_PROJECT_ID` | Tillståndsutkast / RAG mot Vertex |
| `LANTMATERIET_*` (live) | Fastighetsuppslag — ej demo |

## Testinventering

Kommando: `npx playwright test tests/e2e/staging-core-flows.spec.ts --list`

**10 tester** i `staging-core-flows.spec.ts` (P3 utan BankID).

## Körningar

| Datum | Miljö | Kommando | Resultat | Ansvarig | Kommentar |
|-------|--------|----------|----------|----------|-----------|
| 2026-06-09 | Lokal | `npx playwright test tests/e2e/staging-core-flows.spec.ts --list` | Pass | Plattformsanalys | 10 P3-tester identifierade |
| 2026-06-09 | Lokal | `npx tsc --noEmit` | Pass (efter import-test fix) | Plattformsanalys | Typecheck efter säkerhets/deploy-ändringar |
| 2026-06-09 | Staging URL | `PLAYWRIGHT_BASE_URL=<staging-ui> PLAYWRIGHT_API_BASE_URL=<staging-api> npm run e2e:staging` | **Ej körd** | — | Kräver staging-secrets + LM live + Vertex i GitHub/staging env |

## Blockerare före grön staging-E2E

1. `STAGING_URL` / `PLAYWRIGHT_BASE_URL` saknas i aktuell agent-miljö
2. Tidigare lokal körning (2026-04-25): 8/10 pass — fail på `LIVE_LANTMATERIET_REQUIRED` och `VERTEX_PROJECT_ID`
3. Efter denna iteration: deploy-drift i `cloudbuild.yaml` åtgärdad; metrics/WebSocket skyddade — **omdeploy staging** krävs innan ny full körning

## Verifieringskommandon (efter staging-deploy)

```powershell
$env:PLAYWRIGHT_BASE_URL = "<staging-ui>"
$env:PLAYWRIGHT_API_BASE_URL = "<staging-api>"
$env:STAGING_ADMIN_USERNAME = "<admin>"
$env:STAGING_ADMIN_PASSWORD = "<secret>"
npm run e2e:staging
```

Artefakter vid fel: `test-results/`, `playwright-report/`.

## Koppling till checklista

Uppdatera rad i [production-readiness-checklist.md](production-readiness-checklist.md) § P3 Staging E2E-bevislogg när staging-körning är grön.
