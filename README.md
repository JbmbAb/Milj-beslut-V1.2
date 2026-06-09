<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Miljöbeslut.se – Plattform för automatiserad miljöprövning (v2.0)

Välkommen till den ledande plattformen för digitalisering av miljöbeslut och fastighetsanalys. Version 2.0 introducerar en helt ny, professionell **CoreWorkflowView** för effektiv ärendehantering, AI-driven dokumentanalys och en säker, multi-tenant arkitektur.

## Nyckelfunktioner i v2.0

- **Professional Core Workflow**: Helt integrerad ärendegång med automatiserade compliance-kontroller.
- **Säkerhetsfokus**: Persistent BankID-replay skydd och isolerad underhållslogik.
- **AI-Klassificering**: Automatiserad extraktion av krav och risker direkt från dokument.
- **Kvalitetsmål**: `typecheck`, `lint`, tester, `build` och integrationssmoke ska vara gröna innan produktion; kör dem lokalt — _”produktionsredo” är alltså bevis via dessa gates, inte en statisk etikett._

## Arkitekturöversikt: Separerade Tjänster

Plattformen är designad för robust och skalbar drift i molnet genom att separera webbservern från tunga bakgrundsjobb. Detta minskar risker och möjliggör oberoende skalning av varje del.

| Tjänst / Worker                | Syfte                                                                   | Driftsätts som    |
| ------------------------------ | ----------------------------------------------------------------------- | ----------------- |
| **miljobeslut-web**            | Hanterar alla API-anrop från användare och frontend.                    | Cloud Run Service |
| **miljobeslut-search-worker**  | En ständigt aktiv arbetare som indexerar dokument för sökning.          | Cloud Run Service |
| **miljobeslut-gdpr-worker**    | Ett schemalagt jobb som kör GDPR-underhåll (arkivering/radering).       | Cloud Run Job     |
| **miljobeslut-domstol-worker** | Ett schemalagt jobb som hämtar och bearbetar RSS-flöden från domstolar. | Cloud Run Job     |

## Run Locally

**Prerequisites:** Node.js

1. Install dependencies: `npm install`
2. Kopiera `.env.example` till `.env` och fyll i minst `DATABASE_URL`. För **lokal utveckling före BankID-avtal**:
   - `ADMIN_CONSOLE_USERNAME=admin` och `ADMIN_CONSOLE_PASSWORD=admin` (fördefinierat i exempel — byt före skarp produktion)
   - **Vertex (Gemini) i moln:** sätt `VERTEX_PROJECT_ID` och kör `gcloud auth application-default login` så `GOOGLE_APPLICATION_CREDENTIALS` kan lämnas tom lokalt, eller peka mot en tjänstekonto-JSON.
3. Kör: `npm run dev` (frontend) och i separat terminal `npm run dev:server` om du behöver fullt API (standard enligt `package.json`).
   - **Webbläsaren:** öppna **http://localhost:3000** — där är inloggningssidan (BankID + **admin** längre ned). Före BankID-avtal eller certifikat: använd normalt **admininloggningen**. Vite proxar `/api` till backend (**http://localhost:8787** om `PORT` inte satts), så du behöver inte anropa 8787 manuellt från UI.
   - **Bara admin, utan BankID i gränssnittet:** sätt `VITE_LOGIN_ADMIN_ONLY=true` (t.ex. i `.env`), starta om `npm run dev`. Döljs endast inloggningssteget för BankID; backend-rutter och andra e‑leg-flöden ändras inte.

**VS Code / agenter (Gemini DB, read-only):** sätt `GEMINI_DB_API_KEY` i `.env` om du använder `/api/gemini-db/*` enligt avsnittet nedan — det är separat från Vertex i drift.

## Security backend additions

- See `SECURITY_BACKEND_README.md` for secure B2B backend architecture.
- Required env vars are listed in `.env.example`.
- Prisma schema is in `prisma/schema.prisma`.
- Secure API router lives in `server/secureApi.express.ts`.
- Read-only Gemini DB router lives in `server/geminiDbApi.express.ts`.
- Gemini DB API (for local agent tools in VS Code):
  - Set `GEMINI_DB_API_KEY` in `.env`
  - Optional: set `GEMINI_DB_ALLOW_REMOTE=true` only if you explicitly want non-localhost access
  - Endpoints (read-only):
    - `GET /api/gemini-db/health`
    - `GET /api/gemini-db/requirements/cases`
    - `GET /api/gemini-db/requirements/rows`
    - `GET /api/gemini-db/requirements/rows/:requirementCode`
    - `GET /api/gemini-db/requirements/citations`
- Datasource classification and open-source sync:
  - `GET /api/datasources/catalog`
  - `POST /api/datasources/open/sync`
  - `GET /api/datasources/slu/status`
  - `GET /api/datasources/slu/ping/:product` where product is `species_observations|taxonomy|artfakta|metodkatalog`
  - `POST /api/datasources/slu/observations`
  - `POST /api/datasources/slu/proxy`
  - `powershell -ExecutionPolicy Bypass -File scripts/update-datasource-excel.ps1`
  - `powershell -ExecutionPolicy Bypass -File scripts/fetch-open-sources.ps1`
  - Project plan smoke test (DB load/save/template/gates/carbon):
    - with token:
      - `powershell -ExecutionPolicy Bypass -File scripts/smoke-project-plan.ps1 -BaseUrl http://localhost:8787 -ProjectId <project-id> -Token <access-token>`
    - with admin login:
      - `powershell -ExecutionPolicy Bypass -File scripts/smoke-project-plan.ps1 -BaseUrl http://localhost:8787 -ProjectId <project-id> -Username admin -Password <admin-password>`

## Dispatch provider feature flag

- Dispatch provider can be switched without UI code changes via `.env`:
  - `DISPATCH_PROVIDER_MODE=TIMOCOM|TRANS_EU`
- Current adapter behavior:
  - `TIMOCOM` requires `TIMOCOM_API_KEY`, otherwise transportflodet blockeras.
  - `TRANS_EU` requires `TRANS_EU_API_KEY`, otherwise transportflodet blockeras.
- Full external adapter wiring is still intentionally gated behind credentials and supplier contracts.

## QA and test package

- Quality gates (verifierade, finns i `package.json`):
  - `npm run typecheck`
  - `npm run lint`
  - `npm run format:check`
  - `npm run test:unit`
  - `npm run test:component`
  - `npm run test` (kombinerad)

### Smoketester (ny i helikopter-åtgärd 2026-04-19)

Funktionskontrollerar plattformens integrations-, kartlager-, PostGIS- och
juridikdatayta. Kräver normalt att servern är igång (`BASE_URL` för API-tester)
eller att `DATABASE_URL` pekar på körbar PostGIS-instans för DB-tester.

- `npm run smoke:map-layers` — pingar alla `/api/layers/*` plus semantiska `/api/geodata/*` och verifierar GeoJSON
- `npm run smoke:postgis` — kontrollerar PostGIS-version, extensions, GIST, `ST_Intersects`
- `npm run smoke:legal-ingest` — kör domstols-RSS en gång och loggar `pipeline_run`
- `npm run smoke:legal-sort` — verifierar stabil sortering + relevansranking
- `npm run smoke:integrations` — rapporterar CONFIGURED/DEGRADED/MISSING per integration
- `npm run smoke` — kör alla smoketester sekventiellt
- `npm run db:spatial` — idempotent körning av alla `prisma/spatial/*.sql`

### Importarkiv på extern disk

- Plattformen följer [Mimers Brunn offline-first policy](docs/architecture/mimers-brunn-offline-first.md): Master-arkivet på `H:\Delade enheter\Miljöbeslut\GEO_Master_Archive` är canonical för beslutskritisk geodata och källdokument.
- Sätt `IMPORT_ARCHIVE_ROOT`, `IMPORT_SOURCE_ROOT`, `IMPORT_CACHE_ROOT` och `IMPORT_REIMPORT_SCAN_ROOTS` så nya pipelines använder Master-arkivet. Gamla rötter som `D:\GEodata`, `D:\Geo inlärning` och `C:\GEO PDF` är migrationskällor, inte permanent source of truth.
- `npm run archive:import-sources -- --source <path>` arkiverar importerat källmaterial till `IMPORT_ARCHIVE_ROOT`.
- `npm run scan:import-sources` letar efter manifest, shapefiles och arkiv under de konfigurerade scan-rötterna och föreslår återimport.
- `npm run import:legal:corpus -- --root-dir <path>` importerar legal corpus från vald arkivkatalog, normalt under Master-arkivet.

### Analys av fallerande tester

- `npm run analyze:vitest-failures` läser `.tmp-vitest-unit.json` och skriver
  `docs/qa/vitest-backlog.md` grupperat per domän (gis, legal, ingest, property,
  övrigt).

### Integrationsstatus (snapshot 2026-04-19)

| Integration                         | Status              | Nycklar                                                                                        |
| ----------------------------------- | ------------------- | ---------------------------------------------------------------------------------------------- |
| Vertex AI (Gemini via GCP)          | Live                | `VERTEX_PROJECT_ID`, `VERTEX_LOCATION`, service account eller `GOOGLE_APPLICATION_CREDENTIALS` |
| Lantmäteriet (avgiftsfria tjänster) | Live                | `LANTMATERIET_OPEN_SUBSCRIPTION_KEY` (räcker för alla öppna produkter)                         |
| Lantmäteriet (fastighetsuppslag)    | Live (valfritt)     | `LANTMATERIET_CONSUMER_KEY/SECRET` eller `_ACCESS_TOKEN`                                       |
| SGU                                 | Live (publikt OGC)  | –                                                                                              |
| SMHI                                | Live (publikt)      | –                                                                                              |
| Naturvårdsverket (NVR)              | Lokal PostGIS       | importerad data i `env.protected_area`                                                         |
| SLU Artdatabanken                   | Kräver nyckel       | `SLU_API_KEY`, `SLU_SPECIES_OBS_API_KEY` m.fl.                                                 |
| BankID                              | Mock lokalt, live efter avtal | `BANKID_PFX_PATH`/`BANKID_CERT_PATH` + `BANKID_BASE_URL` när avtal och certifikat finns |
| eIDAS QTSP                          | PARTIAL             | `EIDAS_QTSP_ENDPOINT` + `EIDAS_QTSP_API_KEY` (nu med PDF-hash)                                 |
| LIMS                                | HTTP eller SFTP     | `LIMS_API_ENDPOINT`/`LIMS_API_KEY` **eller** `LIMS_SFTP_HOST`/`LIMS_SFTP_PATH`                 |
| Outlook (Graph)                     | PARTIAL             | `OUTLOOK_GRAPH_TENANT_ID/CLIENT_ID/CLIENT_SECRET/USER`                                         |
| Myndighetsinlämning                 | Live eller dev-mock | `AUTHORITY_SUBMIT_ENDPOINT` **eller** `AUTHORITY_MOCK_MODE=true` (endast dev/test)             |
| Domstols-RSS                        | Live (scheduler)    | Aktiv om `DOMSTOL_RSS_ENABLED ≠ false`                                                         |

### Deploy

- **Miljövariabler:** se [docs/deploy/ENV_CHECKLIST.md](docs/deploy/ENV_CHECKLIST.md) (checklista mot `.env.example` för lokal, staging och produktion).
- **Produktion:** Google Cloud — se [`docs/deploy/DEPLOY_GCP.md`](docs/deploy/DEPLOY_GCP.md).
  Cloud Run + Cloud SQL PostGIS + Vertex AI + Secret Manager + Cloud Build.
- **Lantmäteriet öppna tjänster:** komplett dokumentation i
  [`docs/integrations/lantmateriet.md`](docs/integrations/lantmateriet.md).

### Stagingfokus och SLU-nycklar

- De tre styrande modulflödena är **Lokaliseringsutredning**, **C-anmälan** och **Enskilt avlopp**.
- SLU-nycklar läggs lokalt i `.env`/`.env.local` (ej incheckat), i staging som environment secret, och i GCP-produktion via Secret Manager mappat till `SLU_API_KEY` eller produktspecifika `SLU_*_API_KEY`.

Human-in-the-loop remains mandatory for legal/compliance decisions.
Use `docs/qa/legal-review-checklist.md` before merge.
