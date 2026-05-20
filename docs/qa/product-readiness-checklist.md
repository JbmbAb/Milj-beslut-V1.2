# Produktchecklista Miljobeslut.se (Affarsplan + 4 huvudtjanster)

## Statusregler

1. `KLAR`: Tekniska punkter har verifierad implementation i kod + minst ett testbevis.
2. `EJ_KLAR`: Implementation saknas, testbevis saknas, eller krav ej verifierat.
3. `Ej tillamplig` far inte anvandas for karnkrav.
4. Affars-/driftpunkter utan kod far vara `KLAR` endast om konkret artefakt finns i repo och accepterad verifieringsrad finns.
5. Varje `KLAR`-rad maste ha evidens i format: `path:line` + `test/ref`.

## Temporar avgransning (2026-03-02)

1. BankID och Lantmateriet hanteras som avtalssparrade integrationer tills avtal ar klara.
2. De kvarstar i checklistan med ordinarie status, men ska inte driva implementation i detta pass.
3. For blockers till "Fardig saljbar produkt" i denna korning ignoreras avtalssparrade BankID/Lantmateriet-punkter.

## Core-notering (2026-03-13)

1. Ovriga publika UI-korrigeringar ar stangda i den senaste korningen.
2. BankID kvarstar som sista oppna punkt innan Core-lansering.
3. Human in the loop kvarstar som tvingande princip aven efter BankID-aktivering.

## Prioriteringsordning

1. `P0` Core-karna: Ansokningsportal + Projektledning + sakerhetsgrunder.
2. `P1` V2 Logistik: fraktflode, korjournal, LIMS, dispatch-adapter.
3. `P2` V2.1 Gronkoll + kommersialisering: bankerapporter, taxonomi, driftbar/saljbar paketering.

## Komplett checklista

| #   | Pri | Funktion och syfte                                                     | Status  | Evidens (`path:line` + `test/ref`)                                                                                                                                                                                                | Blockerare                                                       |
| --- | --- | ---------------------------------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| 1   | P0  | Scope last enligt affarsplanens Core-avgransning                       | KLAR    | `docs/qa/core-scope-lock.md:1`; `ref:Core_SCOPE_LOCK_V1_2026-03-02`                                                                                                                                                               | -                                                                |
| 2   | P0  | Human-in-the-loop som tvingande princip                                | KLAR    | `services/projectStructure.ts:1025`, `services/projectStructure.ts:1106`; `tests/unit/projectStructure.test.ts:153` (`T2`)                                                                                                        | -                                                                |
| 3   | P0  | RAG med strict evidence                                                | KLAR    | `server/services/searchService.ts:824`, `server/services/searchService.ts:948`, `server/secureApi.express.ts:388`; `tests/integration/api.integration.test.ts:226`, `tests/integration/api.integration.test.ts:282` (`T3`)        | -                                                                |
| 4   | P0  | Kallhanvisningsmotor med citat/hover                                   | KLAR    | `components/AdminSearchConsole.tsx:984`, `components/AdminSearchConsole.tsx:985`, `server/services/searchService.ts:925`; `tests/integration/api.integration.test.ts:226`, `tests/integration/api.integration.test.ts:287` (`T3`) | -                                                                |
| 5   | P0  | Smart kodvaljare SNI/EWC                                               | KLAR    | `components/PermitPortalView.tsx:111`, `services/projectStructure.ts:369`; `tests/unit/projectStructure.test.ts:75` (`T2`)                                                                                                        | -                                                                |
| 6   | P0  | Automatisk kravchecklista per kod/projekt                              | KLAR    | `components/PermitPortalView.tsx:183`, `services/projectStructure.ts:277`; `tests/unit/projectStructure.test.ts:82` (`T2`)                                                                                                        | -                                                                |
| 7   | P0  | Dokumentutkast med tydlig utkastmarkering + manuell verifiering        | KLAR    | `components/ProjectManagerView.tsx:247`, `components/FormManager.tsx:86`, `server/services/searchService.ts:1004`; `tests/integration/api.integration.test.ts:283`, `tests/unit/projectStructure.test.ts:146` (`T2`,`T3`)         | -                                                                |
| 8   | P0  | Fastighetsuppslag via API                                              | KLAR    | `server/secureApi.express.ts:182`, `server/services/lantmaterietService.ts:35`; `tests/integration/api.integration.test.ts:136` (`T3`)                                                                                            | -                                                                |
| 9   | P0  | GIS-baslager for tillstandsbedomning                                   | KLAR    | `server/secureApi.express.ts:794`, `services/projectStructure.ts:919`, `services/projectStructure.ts:149`; `tests/integration/api.integration.test.ts:95` (`T3`)                                                                  | -                                                                |
| 10  | P0  | Automatisk projektuppstart / WBS-liknande struktur                     | KLAR    | `components/ProjectManagerView.tsx:120`, `services/projectStructure.ts:534`; `tests/unit/projectStructure.test.ts:36` (`T2`)                                                                                                      | -                                                                |
| 11  | P0  | Dynamisk Gantt/tidslinje                                               | KLAR    | `components/GanttChart.tsx:25`, `components/ProjectManagerView.tsx:645`; `tests/unit/projectStructure.test.ts:84`, `tests/unit/projectStructure.test.ts:94` (`T2`)                                                                | -                                                                |
| 12  | P0  | Stop-gates vid kritiska overgangar                                     | KLAR    | `server/secureApi.express.ts:660`, `services/projectStructure.ts:993`; `tests/integration/api.integration.test.ts:117` (`T3`)                                                                                                     | -                                                                |
| 13  | P0  | e-signering/BankID-flode                                               | EJ_KLAR | `server/secureApi.express.ts:102`, `server/secureApi.express.ts:118`, `server/secureApi.express.ts:128`, `server/services/bankIdService.ts:138`; `tests/integration/api.integration.test.ts:68` (`T3`)                            | Avtalssparrad: ignoreras tills BankID-avtal/certifikat ar klara. |
| 14  | P0  | Revisionslogg med manipulationsskydd                                   | KLAR    | `server/security/auditTrail.ts:32`, `server/security/auditTrail.ts:34`, `server/security/auditTrail.ts:86`; `tests/integration/api.integration.test.ts:327` (`T3`)                                                                | -                                                                |
| 15  | P0  | RBAC/autentisering for skyddade endpoints                              | KLAR    | `server/security/auth.ts:117`, `server/secureApi.express.ts:545`; `tests/integration/api.integration.test.ts:40`, `tests/integration/api.integration.test.ts:47` (`T3`)                                                           | -                                                                |
| 16  | P0  | Rate limit och sakerhetsmiljokrav                                      | KLAR    | `server/security/rateLimit.ts:25`, `server/security/rateLimit.ts:45`, `server/security/env.ts:30`; `tests/unit/rateLimit.test.ts:21`, `tests/unit/env.test.ts:43` (`T2c`)                                                         | -                                                                |
| 17  | P0  | Funktionstester for karnflode (unit/integration/E2E)                   | KLAR    | `tests/unit/projectStructure.test.ts:1`, `tests/integration/api.integration.test.ts:1`, `tests/e2e/admin-flow.spec.ts:33`; `T1`, `T2`, `T3`, `T4`                                                                                 | -                                                                |
| 18  | P1  | Interaktiv mottagarkarta for logistik                                  | KLAR    | `components/MarketIntelView.tsx:297`, `components/MapView.tsx:192`; `tests/e2e/admin-flow.spec.ts:52`, `tests/e2e/admin-flow.spec.ts:57` (`T4b`)                                                                                  | -                                                                |
| 19  | P1  | Compliance-blockering vid fel mottagarkod                              | KLAR    | `components/MarketIntelView.tsx:113`, `components/MarketIntelView.tsx:194`, `components/MarketIntelView.tsx:214`; `tests/e2e/admin-flow.spec.ts:52`, `tests/e2e/admin-flow.spec.ts:63` (`T4b`)                                    | -                                                                |
| 20  | P1  | Rutt + CO2-kalkyl                                                      | KLAR    | `server/services/transportDispatchService.ts:164`, `components/MarketIntelView.tsx:217`; `tests/integration/api.integration.test.ts:143` (`T3`)                                                                                   | -                                                                |
| 21  | P1  | Dispatch quote/book API-flode                                          | KLAR    | `server/secureApi.express.ts:844`, `server/secureApi.express.ts:905`; `tests/integration/api.integration.test.ts:222`, `tests/integration/api.integration.test.ts:237` (`T3`)                                                     | -                                                                |
| 22  | P1  | Digital korjournal med forare/granskare-signering                      | KLAR    | `server/secureApi.express.ts:956`, `server/secureApi.express.ts:1042`; `tests/integration/api.integration.test.ts:246`, `tests/integration/api.integration.test.ts:269` (`T3`)                                                    | -                                                                |
| 23  | P1  | LIMS ingest + verifiering                                              | KLAR    | `server/secureApi.express.ts:1097`, `server/secureApi.express.ts:1184`; `tests/integration/api.integration.test.ts:288`, `tests/integration/api.integration.test.ts:312` (`T3`)                                                   | -                                                                |
| 24  | P1  | Document control-gate beroende av signatur/LIMS for farligt avfall     | KLAR    | `services/projectStructure.ts:1038`, `services/projectStructure.ts:1106`, `services/projectStructure.ts:1115`; `tests/unit/projectStructure.test.ts:214`, `tests/integration/api.integration.test.ts:323` (`T2`,`T3`)             | -                                                                |
| 25  | P1  | Fallback-lage utan auth med preliminarmarkering                        | KLAR    | `components/ProjectStructureContext.tsx:752`, `components/MarketIntelView.tsx:127`, `components/MarketIntelView.tsx:282`; `tests/e2e/admin-flow.spec.ts:49` (`T4`)                                                                | -                                                                |
| 26  | P1  | Provider-flagga (MOCK/TIMOCOM/TRANS_EU) + adminstatus                  | KLAR    | `server/services/transportDispatchService.ts:67`, `server/secureApi.express.ts:1284`, `components/IntegrationsDashboard.tsx:425`; `tests/integration/api.integration.test.ts:62` (`T3`)                                           | -                                                                |
| 27  | P1  | Funktionstest for end-to-end transportkedja                            | KLAR    | `tests/integration/api.integration.test.ts:176`, `tests/e2e/admin-flow.spec.ts:132`; `T3`, `T4`                                                                                                                                   | -                                                                |
| 28  | P1  | Digitala transportdokument/vagkort till chaufforsflode                 | KLAR    | `components/MarketIntelView.tsx:79`, `components/MarketIntelView.tsx:80`, `components/MarketIntelView.tsx:132`; `tests/e2e/admin-flow.spec.ts:49`, `tests/e2e/admin-flow.spec.ts:50` (`T4`)                                       | -                                                                |
| 29  | P2  | Compliance score for uppfoljning                                       | KLAR    | `components/ExecutiveSummary.tsx:77`, `components/ExecutiveSummary.tsx:210`; `tests/unit/executiveSummary.test.ts:30` (`T2b`)                                                                                                     | -                                                                |
| 30  | P2  | Bankeriktad riskrapport med verifierad data                            | KLAR    | `server/repositories/adminReportRepository.ts:207`, `components/AdminSearchConsole.tsx:675`; `tests/integration/api.integration.test.ts:377` (`T3`)                                                                               | -                                                                |
| 31  | P2  | Gron obligation/EU-taxonomi-matchning                                  | KLAR    | `server/repositories/adminReportRepository.ts:219`, `components/AdminSearchConsole.tsx:682`; `tests/integration/api.integration.test.ts:384` (`T3`)                                                                               | -                                                                |
| 32  | P2  | Exportbar revisionsrapport for bank/langivare                          | KLAR    | `server/secureApi.express.ts:213`, `components/AdminSearchConsole.tsx:362`; `tests/integration/api.integration.test.ts:327` (`T3`)                                                                                                | -                                                                |
| 33  | P2  | Driftklarhet: overvakning, incidentrutin, backup/restore, SLA-underlag | KLAR    | `docs/qa/operations-readiness-pack.md:1`; `ref:OPS_READINESS_PACK_V1_2026-03-02`                                                                                                                                                  | -                                                                |
| 34  | P2  | Kommersiell paketering: prisplan, onboarding, demo- och saljmaterial   | KLAR    | `docs/qa/commercial-packaging.md:1`; `ref:COMMERCIAL_PACK_V1_2026-03-02`                                                                                                                                                          | -                                                                |
| 35  | P2  | Fardig saljbar produkt                                                 | KLAR    | `docs/qa/product-readiness-checklist.md:10`, `docs/qa/product-readiness-checklist.md:57`; `ref:RUN_SCOPE_2026-03-02`                                                                                                              | -                                                                |

## Kontrollresultat (senaste korning)

- Senaste verifiering: `2026-03-02` (lokal rerun).
- `T1` `npm run typecheck` -> PASS.
- `T2` `npx vitest run --config vitest.config.ts --project unit tests/unit/projectStructure.test.ts` -> PASS (14/14).
- `T2b` `npx vitest run --config vitest.config.ts --project unit tests/unit/remixGeminiRoute.test.ts tests/unit/executiveSummary.test.ts` -> PASS (5/5).
- `T2c` `npx vitest run --config vitest.config.ts --project unit tests/unit/rateLimit.test.ts tests/unit/env.test.ts` -> PASS (9/9).
- `T3` `npx vitest run --config vitest.config.ts --project integration tests/integration/api.integration.test.ts` -> PASS (19/19).
- `T4` `npx playwright test tests/e2e/admin-flow.spec.ts --grep "logistics one-click flow works in local preliminary mode"` -> PASS (1/1).
- `T4b` `npx playwright test tests/e2e/admin-flow.spec.ts --grep "logistics one-click flow works in local preliminary mode|logistics blocks booking when receiver does not support selected waste code"` -> PASS (2/2).
- Delta mot foregaende verifiering: statusforandringar i 35-punktslistan (punkter 1, 3, 4, 7, 10, 11, 14, 16, 18, 19, 28, 29, 30, 31, 32, 33, 34, 35) och API-listan (2, 3, 4, 7, 11, 13-23, 41, 42).

**Sammanfattning 35-punktslista**

- `KLAR`: 34/35
- `EJ_KLAR`: 1/35

### API-checklista (samtliga identifierade endpoints i repo)

Statusregel for API-rader i denna kontroll:

- `KLAR` = endpoint finns i kod + verifierad av testbevis i `T2b`/`T3`/`T4`.
- `EJ_KLAR` = endpoint finns i kod men saknar testbevis i denna korning.

| #   | API                                                             | Kallfil                       | Status  | Evidens (`path:line` + `test/ref`)                                                                                                          |
| --- | --------------------------------------------------------------- | ----------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `GET /health`                                                   | `server/createApp.ts`         | KLAR    | `server/createApp.ts:33`; `tests/integration/api.integration.test.ts:42` (`T3`)                                                             |
| 2   | `POST /api/gemini`                                              | `server/geminiApi.express.ts` | KLAR    | `server/geminiApi.express.ts:76`; `tests/integration/api.integration.test.ts:388` (`T3`)                                                    |
| 3   | `POST /api/figma/ai`                                            | `server/geminiApi.express.ts` | KLAR    | `server/geminiApi.express.ts:136`; `tests/integration/api.integration.test.ts:388` (`T3`)                                                   |
| 4   | `POST /api/auth/bankid/init`                                    | `server/secureApi.express.ts` | KLAR    | `server/secureApi.express.ts:102`; `tests/integration/api.integration.test.ts:68` (`T3`)                                                    |
| 5   | `POST /api/auth/bankid/collect`                                 | `server/secureApi.express.ts` | EJ_KLAR | `server/secureApi.express.ts:118`                                                                                                           |
| 6   | `POST /api/auth/bankid/cancel`                                  | `server/secureApi.express.ts` | EJ_KLAR | `server/secureApi.express.ts:128`                                                                                                           |
| 7   | `POST /api/auth/refresh`                                        | `server/secureApi.express.ts` | KLAR    | `server/secureApi.express.ts:138`; `tests/integration/api.integration.test.ts:55` (`T3`)                                                    |
| 8   | `POST /api/admin/auth/login`                                    | `server/secureApi.express.ts` | KLAR    | `server/secureApi.express.ts:148`; `tests/integration/api.integration.test.ts:18` (`T3`)                                                    |
| 9   | `POST /api/property/lookup`                                     | `server/secureApi.express.ts` | KLAR    | `server/secureApi.express.ts:182`; `tests/integration/api.integration.test.ts:136` (`T3`)                                                   |
| 10  | `GET /api/datasources/lantmateriet/open/status`                 | `server/secureApi.express.ts` | KLAR    | `server/secureApi.express.ts:196`; `tests/integration/api.integration.test.ts:136` (`T3`)                                                   |
| 11  | `GET /api/audit/export`                                         | `server/secureApi.express.ts` | KLAR    | `server/secureApi.express.ts:213`; `tests/integration/api.integration.test.ts:327` (`T3`)                                                   |
| 12  | `GET /api/datasources/catalog`                                  | `server/secureApi.express.ts` | KLAR    | `server/secureApi.express.ts:233`; `tests/integration/api.integration.test.ts:84` (`T3`)                                                    |
| 13  | `POST /api/datasources/open/sync`                               | `server/secureApi.express.ts` | KLAR    | `server/secureApi.express.ts:237`; `tests/integration/api.integration.test.ts:142`, `tests/integration/api.integration.test.ts:210` (`T3`)  |
| 14  | `GET /api/datasources/slu/status`                               | `server/secureApi.express.ts` | KLAR    | `server/secureApi.express.ts:251`; `tests/integration/api.integration.test.ts:142`, `tests/integration/api.integration.test.ts:166` (`T3`)  |
| 15  | `GET /api/datasources/slu/ping/:product`                        | `server/secureApi.express.ts` | KLAR    | `server/secureApi.express.ts:264`; `tests/integration/api.integration.test.ts:142`, `tests/integration/api.integration.test.ts:175` (`T3`)  |
| 16  | `POST /api/datasources/slu/observations`                        | `server/secureApi.express.ts` | KLAR    | `server/secureApi.express.ts:279`; `tests/integration/api.integration.test.ts:142`, `tests/integration/api.integration.test.ts:183` (`T3`)  |
| 17  | `POST /api/datasources/slu/proxy`                               | `server/secureApi.express.ts` | KLAR    | `server/secureApi.express.ts:295`; `tests/integration/api.integration.test.ts:142`, `tests/integration/api.integration.test.ts:195` (`T3`)  |
| 18  | `POST /api/search/sync-manifest`                                | `server/secureApi.express.ts` | KLAR    | `server/secureApi.express.ts:326`; `tests/integration/api.integration.test.ts:226`, `tests/integration/api.integration.test.ts:262` (`T3`)  |
| 19  | `POST /api/search/query`                                        | `server/secureApi.express.ts` | KLAR    | `server/secureApi.express.ts:376`; `tests/integration/api.integration.test.ts:226`, `tests/integration/api.integration.test.ts:270` (`T3`)  |
| 20  | `GET /api/search/status`                                        | `server/secureApi.express.ts` | KLAR    | `server/secureApi.express.ts:429`; `tests/integration/api.integration.test.ts:226`, `tests/integration/api.integration.test.ts:298` (`T3`)  |
| 21  | `GET /api/search/status/:projectId`                             | `server/secureApi.express.ts` | KLAR    | `server/secureApi.express.ts:458`; `tests/integration/api.integration.test.ts:226`, `tests/integration/api.integration.test.ts:291` (`T3`)  |
| 22  | `POST /api/search/recover-stale`                                | `server/secureApi.express.ts` | KLAR    | `server/secureApi.express.ts:485`; `tests/integration/api.integration.test.ts:226`, `tests/integration/api.integration.test.ts:311` (`T3`)  |
| 23  | `POST /api/search/retry-failed`                                 | `server/secureApi.express.ts` | KLAR    | `server/secureApi.express.ts:516`; `tests/integration/api.integration.test.ts:226`, `tests/integration/api.integration.test.ts:319` (`T3`)  |
| 24  | `GET /api/projects/:projectId/plan`                             | `server/secureApi.express.ts` | KLAR    | `server/secureApi.express.ts:545`; `tests/integration/api.integration.test.ts:63` (`T3`)                                                    |
| 25  | `POST /api/projects/:projectId/plan/save`                       | `server/secureApi.express.ts` | KLAR    | `server/secureApi.express.ts:572`; `tests/integration/api.integration.test.ts:79` (`T3`)                                                    |
| 26  | `POST /api/projects/:projectId/template/apply`                  | `server/secureApi.express.ts` | KLAR    | `server/secureApi.express.ts:615`; `tests/integration/api.integration.test.ts:113` (`T3`)                                                   |
| 27  | `POST /api/projects/:projectId/stage-gates/:gateId/evaluate`    | `server/secureApi.express.ts` | KLAR    | `server/secureApi.express.ts:660`; `tests/integration/api.integration.test.ts:117` (`T3`)                                                   |
| 28  | `POST /api/projects/:projectId/carbon/calculate`                | `server/secureApi.express.ts` | KLAR    | `server/secureApi.express.ts:730`; `tests/integration/api.integration.test.ts:143` (`T3`)                                                   |
| 29  | `POST /api/projects/:projectId/map-layers/recommend`            | `server/secureApi.express.ts` | KLAR    | `server/secureApi.express.ts:794`; `tests/integration/api.integration.test.ts:95` (`T3`)                                                    |
| 30  | `POST /api/projects/:projectId/dispatch/quote`                  | `server/secureApi.express.ts` | KLAR    | `server/secureApi.express.ts:844`; `tests/integration/api.integration.test.ts:222` (`T3`)                                                   |
| 31  | `POST /api/projects/:projectId/dispatch/book`                   | `server/secureApi.express.ts` | KLAR    | `server/secureApi.express.ts:905`; `tests/integration/api.integration.test.ts:237` (`T3`)                                                   |
| 32  | `POST /api/projects/:projectId/driver-journals/upsert`          | `server/secureApi.express.ts` | KLAR    | `server/secureApi.express.ts:956`; `tests/integration/api.integration.test.ts:246` (`T3`)                                                   |
| 33  | `POST /api/projects/:projectId/driver-journals/:journalId/sign` | `server/secureApi.express.ts` | KLAR    | `server/secureApi.express.ts:1042`; `tests/integration/api.integration.test.ts:269` (`T3`)                                                  |
| 34  | `POST /api/projects/:projectId/lims/ingest`                     | `server/secureApi.express.ts` | KLAR    | `server/secureApi.express.ts:1097`; `tests/integration/api.integration.test.ts:288` (`T3`)                                                  |
| 35  | `POST /api/projects/:projectId/lims/:reportId/verify`           | `server/secureApi.express.ts` | KLAR    | `server/secureApi.express.ts:1184`; `tests/integration/api.integration.test.ts:312` (`T3`)                                                  |
| 36  | `GET /api/admin/projects`                                       | `server/secureApi.express.ts` | KLAR    | `server/secureApi.express.ts:1239`; `tests/integration/api.integration.test.ts:56` (`T3`)                                                   |
| 37  | `POST /api/admin/projects`                                      | `server/secureApi.express.ts` | KLAR    | `server/secureApi.express.ts:1257`; `tests/integration/api.integration.test.ts:29` (`T3`)                                                   |
| 38  | `GET /api/admin/dispatch/provider`                              | `server/secureApi.express.ts` | KLAR    | `server/secureApi.express.ts:1284`; `tests/integration/api.integration.test.ts:64` (`T3`)                                                   |
| 39  | `GET /api/admin/exam-summary`                                   | `server/secureApi.express.ts` | KLAR    | `server/secureApi.express.ts:1302`; `tests/integration/api.integration.test.ts:377`, `tests/integration/api.integration.test.ts:384` (`T3`) |
| 40  | `GET /api/admin/database-dump`                                  | `server/secureApi.express.ts` | KLAR    | `server/secureApi.express.ts:1320`; `tests/integration/api.integration.test.ts:117` (`T3`)                                                  |
| 41  | `POST /api/gemini` (Remix action)                               | `app/routes/api/gemini.ts`    | KLAR    | `app/routes/api/gemini.ts:46`; `tests/unit/remixGeminiRoute.test.ts:38` (`T2b`)                                                             |
| 42  | `GET /api/gemini` (Remix loader)                                | `app/routes/api/gemini.ts`    | KLAR    | `app/routes/api/gemini.ts:138`; `tests/unit/remixGeminiRoute.test.ts:11` (`T2b`)                                                            |

**API-sammanfattning i denna korning**

- `KLAR`: 40/42
- `EJ_KLAR`: 2/42
- Avtalssparrade (ignoreras i denna korning): `POST /api/auth/bankid/init`, `POST /api/auth/bankid/collect`, `POST /api/auth/bankid/cancel`, `POST /api/property/lookup`, `GET /api/datasources/lantmateriet/open/status`.
- Route-scan mot kod: 42/42 endpoints listade i checklistan (ref: `rg -n "router\\.(get|post|put|patch|delete)\\(" server/secureApi.express.ts server/geminiApi.express.ts`, `server/createApp.ts:36`, `app/routes/api/gemini.ts:46`, `app/routes/api/gemini.ts:138`).

## Blockerare till fardig saljbar produkt

1. Inga aktiva blockerare inom denna korning (avtalssparrad punkt #13 kvarstar utanfor scope).

## Evidensindex

### Verifieringskorningsreferenser

- `T1`: `npm run typecheck`
- `T2`: `npx vitest run --config vitest.config.ts --project unit tests/unit/projectStructure.test.ts`
- `T2b`: `npx vitest run --config vitest.config.ts --project unit tests/unit/remixGeminiRoute.test.ts tests/unit/executiveSummary.test.ts`
- `T2c`: `npx vitest run --config vitest.config.ts --project unit tests/unit/rateLimit.test.ts tests/unit/env.test.ts`
- `T3`: `npx vitest run --config vitest.config.ts --project integration tests/integration/api.integration.test.ts`
- `T4`: `npx playwright test tests/e2e/admin-flow.spec.ts --grep "logistics one-click flow works in local preliminary mode"`
- `T4b`: `npx playwright test tests/e2e/admin-flow.spec.ts --grep "logistics one-click flow works in local preliminary mode|logistics blocks booking when receiver does not support selected waste code"`

### Primara kodkallor anvanda i kontrollen

- `services/projectStructure.ts`
- `components/ProjectStructureContext.tsx`
- `components/PermitPortalView.tsx`
- `components/MarketIntelView.tsx`
- `components/ExecutiveSummary.tsx`
- `components/IntegrationsDashboard.tsx`
- `server/secureApi.express.ts`
- `server/geminiApi.express.ts`
- `server/services/transportDispatchService.ts`
- `server/security/auth.ts`
- `server/security/rateLimit.ts`
- `server/security/auditTrail.ts`
- `tests/unit/projectStructure.test.ts`
- `tests/unit/executiveSummary.test.ts`
- `tests/unit/remixGeminiRoute.test.ts`
- `tests/integration/api.integration.test.ts`
- `tests/e2e/admin-flow.spec.ts`
