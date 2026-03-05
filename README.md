<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/c85fb0f1-3062-4d35-b8b2-f24498822624

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

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
  - `DISPATCH_PROVIDER_MODE=MOCK_FRAKTBORS|TIMOCOM|TRANS_EU`
- Current adapter behavior:
  - `MOCK_FRAKTBORS` is always available.
  - `TIMOCOM` requires `TIMOCOM_API_KEY`, otherwise server falls back to `MOCK_FRAKTBORS`.
  - `TRANS_EU` requires `TRANS_EU_API_KEY`, otherwise server falls back to `MOCK_FRAKTBORS`.
- Full external adapter wiring is still intentionally gated behind credentials and supplier contracts.

## QA and test package

- Environment:
  - copy `.env.test.example` to `.env.test`
- Database (test):
  - `npm run db:test:migrate`
  - `npm run db:test:seed`
- Quality gates:
  - `npm run typecheck`
  - `npm run lint`
  - `npm run format:check`
- Automated tests:
  - `npm run test:unit`
  - `npm run test:integration`
  - `npm run test:e2e`
- Full local pipeline:
  - `powershell -ExecutionPolicy Bypass -File scripts/test/run-all.ps1 -Full`

Human-in-the-loop remains mandatory for legal/compliance decisions.
Use `docs/qa/legal-review-checklist.md` before merge.
