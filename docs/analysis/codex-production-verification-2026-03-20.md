# Codex Production Verification 2026-03-20

## Scope

Detta svep verifierar den kvarvarande Codex-delen efter senaste implementationerna:

- staging-kompatibel Playwright/E2E
- lokal smoke-korning med egen testbootstrap
- dokumentflode for upload/view/download/delete
- external health-route
- permit-submit-adapter med mock/external split
- kort produktionsrapport med faktiska blockerare

Ingen full omindexering eller DB-migration utover vanliga testmigreringar ingick.

## Implementerat i detta steg

- Ny lokal/staging-kompatibel smoke-runner:
  - [scripts/run-staging-smoke.mjs](c:\Users\jimmy\Desktop\Examens arbete\Kod\Ny mapp\remix_-copy-of-miljöbeslut.se-portal\scripts\run-staging-smoke.mjs)
  - [playwright.config.ts](c:\Users\jimmy\Desktop\Examens arbete\Kod\Ny mapp\remix_-copy-of-miljöbeslut.se-portal\playwright.config.ts)
  - [tests/e2e/staging-smoke.spec.ts](c:\Users\jimmy\Desktop\Examens arbete\Kod\Ny mapp\remix_-copy-of-miljöbeslut.se-portal\tests\e2e\staging-smoke.spec.ts)
  - [tests/e2e/support.ts](c:\Users\jimmy\Desktop\Examens arbete\Kod\Ny mapp\remix_-copy-of-miljöbeslut.se-portal\tests\e2e\support.ts)
- Riktiga dokumentrutter i backend:
  - [secureApi.express.ts](c:\Users\jimmy\Desktop\Examens arbete\Kod\Ny mapp\remix_-copy-of-miljöbeslut.se-portal\server\secureApi.express.ts)
  - `POST /api/documents/upload`
  - `GET /api/documents/:documentId/view`
  - `GET /api/documents/:documentId/download`
  - `DELETE /api/documents/:documentId`
- External health-route tillbaka i backend:
  - [secureApi.express.ts](c:\Users\jimmy\Desktop\Examens arbete\Kod\Ny mapp\remix_-copy-of-miljöbeslut.se-portal\server\secureApi.express.ts)
  - `GET /api/admin/external-health`
- Permit-adapter och statusmappning:
  - [permitAuthorityAdapter.ts](c:\Users\jimmy\Desktop\Examens arbete\Kod\Ny mapp\remix_-copy-of-miljöbeslut.se-portal\server\services\permitAuthorityAdapter.ts)
  - [permitAuthorityService.ts](c:\Users\jimmy\Desktop\Examens arbete\Kod\Ny mapp\remix_-copy-of-miljöbeslut.se-portal\server\services\permitAuthorityService.ts)
- Robust testseed utan Prisma runtime-klient:
  - [scripts/db/seed-test.sql](c:\Users\jimmy\Desktop\Examens arbete\Kod\Ny mapp\remix_-copy-of-miljöbeslut.se-portal\scripts\db\seed-test.sql)
  - [package.json](c:\Users\jimmy\Desktop\Examens arbete\Kod\Ny mapp\remix_-copy-of-miljöbeslut.se-portal\package.json)
- Staging-workflow och secrets-underlag uppdaterade tidigare i samma arbetslinje:
  - [deploy-staging.yml](c:\Users\jimmy\Desktop\Examens arbete\Kod\Ny mapp\remix_-copy-of-miljöbeslut.se-portal\.github\workflows\deploy-staging.yml)
  - [secrets.md](c:\Users\jimmy\Desktop\Examens arbete\Kod\Ny mapp\remix_-copy-of-miljöbeslut.se-portal\docs\ops\secrets.md)

## Korda verifieringar

### Grona

- Riktad unit-verifiering passerar:
  - `30/30` tester i auth, external health, dokumentupload/view/access och permit-service
- Riktad lint for berorda TS/JS-filer passerar
- Lokal staging-smoke passerar:
  - `4/4` tester grona via `npm run test:e2e:staging`
  - verifierar:
    - `/health`
    - admin-login + skyddat projektflode
    - upload/view/download/delete
    - admin-UI-vagen till analys/compliance

### Roda eller delvis roda

- Full repo-typecheck ar fortfarande rod:
  - `npm run typecheck`
- Riktad integrationskorning ar fortfarande delvis rod:
  - `tests/integration/datasourceMocks.integration.test.ts` faller
  - `tests/integration/api.integration.test.ts` ar fortfarande skip-markerad i denna korning

## Maste-fixas-nu

Detta blockerar fortfarande en ren prod-signal:

1. Full repo-typecheck
- [app/routes/api/gemini.ts](c:\Users\jimmy\Desktop\Examens arbete\Kod\Ny mapp\remix_-copy-of-miljöbeslut.se-portal\app\routes\api\gemini.ts)
  - async auth drift: `getUserFromAccessToken` behandlas som synk
- [server/geminiDbApi.express.ts](c:\Users\jimmy\Desktop\Examens arbete\Kod\Ny mapp\remix_-copy-of-miljöbeslut.se-portal\server\geminiDbApi.express.ts)
  - `organisationId` saknas nu i kravfilteranrop
- [server/secureApi.express.ts](c:\Users\jimmy\Desktop\Examens arbete\Kod\Ny mapp\remix_-copy-of-miljöbeslut.se-portal\server\secureApi.express.ts)
  - flera kvarvarande typfel kring `organisationId`, `string | string[]` och bbox-casts
- [server/services/mvpContractService.ts](c:\Users\jimmy\Desktop\Examens arbete\Kod\Ny mapp\remix_-copy-of-miljöbeslut.se-portal\server\services\mvpContractService.ts)
  - kravfilter utan `organisationId`
- [server/services/ocrService.ts](c:\Users\jimmy\Desktop\Examens arbete\Kod\Ny mapp\remix_-copy-of-miljöbeslut.se-portal\server\services\ocrService.ts)
  - `pdf-parse`-typning
- [server/services/ragSearchService.ts](c:\Users\jimmy\Desktop\Examens arbete\Kod\Ny mapp\remix_-copy-of-miljöbeslut.se-portal\server\services\ragSearchService.ts)
  - modell/typdrift kring `chunkId` och `score`
- [tests/unit/auditTrail.test.ts](c:\Users\jimmy\Desktop\Examens arbete\Kod\Ny mapp\remix_-copy-of-miljöbeslut.se-portal\tests\unit\auditTrail.test.ts)
  - gamla synk-antaganden mot nuvarande async API

2. Saknade beroenden for full kompilering
- [server/services/backupService.ts](c:\Users\jimmy\Desktop\Examens arbete\Kod\Ny mapp\remix_-copy-of-miljöbeslut.se-portal\server\services\backupService.ts)
  - `@aws-sdk/client-s3` saknas
- [server/services/errorTrackingService.ts](c:\Users\jimmy\Desktop\Examens arbete\Kod\Ny mapp\remix_-copy-of-miljöbeslut.se-portal\server\services\errorTrackingService.ts)
  - `@sentry/node` saknas

3. En integrationssvit har fortfarande gammalt auth-/DB-antagande
- [datasourceMocks.integration.test.ts](c:\Users\jimmy\Desktop\Examens arbete\Kod\Ny mapp\remix_-copy-of-miljöbeslut.se-portal\tests\integration\datasourceMocks.integration.test.ts)
  - faller pa `401` vid `POST /api/admin/projects`
  - loggen visar att tokenvalidering fortfarande gar mot fel DB-credentials i just den sviten

## Kan-vanta

1. Plattformskoppling for riktig staging-deploy
- Workflowet ar nu byggt for riktig deploykedja, men det ar fortfarande externt blockerande att satt:
  - `STAGING_DEPLOY_COMMAND`
  - `STAGING_URL`
  - riktiga staging-secrets

2. Riktig permit-submit mot myndighet
- Adapterlagret ar klart, men skarp integration ar fortfarande blockerad av:
  - endpoint
  - authmodell
  - request/response-kontrakt
  - avtal

3. Bredare integrations- och prodhardning
- Fler integrationssviter kan nu kopplas in nar typechecken och env-driften ovan ar stangda

## Slutsats

Codex-delen har tagit ett tydligt steg fram:

- staging-kompatibel E2E finns
- lokal smoke ar gron
- dokumentflodet ar riktigt verifierat
- permit-flodet har nu korrekt mock/external-grans

Den mest korrekta kvarvarande bilden ar darfor:

- funktions- och smoke-niva: gron
- full compile-/integration-niva: inte gron an

Det som blockerar full slutstangning ar nu framst repo-wide typecheck, nagra gamla integrationsantaganden och den externa plattformskopplingen for verklig stagingdeploy.
