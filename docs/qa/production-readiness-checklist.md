# Checklista: från nuvarande läge till 100 % funktionsdugligt (på riktigt)

Denna lista är avsedd för **praktisk go-live** och **acceptans**: varje bock ska kunna verifieras i **staging** och därefter **produktion**.  
**Källspår:** feature-status i `server/services/completionService.ts` (manifest), miljövariabler i `.env.example`, samt kod runt mock-/demo-lägen.

## P3: Produktionsscope utan BankID

BankID är **utanför P3-scope** tills avtal och certifikat är klara. P3-gaten får därför inte blockeras av BankID, men den får inte heller använda BankID-mock som bevis för produktionsstabilitet.

| Kärnflöde                     | Ingår i P3 | Primärt bevis                                                                                  |
| :---------------------------- | :--------: | :--------------------------------------------------------------------------------------------- |
| Projektstart och adminsession |     Ja     | API-login, projekt skapas, aktivt projekt används i UI                                         |
| Fastighet/karta               |     Ja     | `/api/property/lookup` returnerar verifierad icke-demo-geometri och kartvyn renderar i browser |
| Kravanalys                    |     Ja     | `/api/admin/requirements/cases` svarar grönt med adminauth                                     |
| Dokumentuppladdning           |     Ja     | `/api/documents/upload` skapar dokument och köar indexering                                    |
| RAG                           |     Ja     | `/api/search/status/:projectId` och `/api/search/rag` svarar `ok: true`                        |
| Tillståndsutkast              |     Ja     | `/api/projects/:projectId/permit/generate` kör Vertex-flödet med koordinater                   |
| Audit/export                  |     Ja     | `/api/audit/export` svarar `ok: true`                                                          |
| BankID                        |    Nej     | Avtalsspärrat; verifieras i separat gate när avtal/certifikat finns                            |

## P3: Staging E2E-bevislogg

Varje rad ska fyllas med faktisk körning. En P3-signoff kräver grön rad mot staging-URL, inte bara lokal enhetstestning.

| Datum      | Miljö             | Kommando                                                                                     | Resultat                                                              | Ansvarig | Artefakt / kommentar                                                                            |
| :--------- | :---------------- | :------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------- | :------- | :---------------------------------------------------------------------------------------------- |
| 2026-04-25 | Lokal kodkontroll | `npx playwright test tests/e2e/staging-core-flows.spec.ts --list`                            | Pass: 10 P3-tester upptäckta                                          | Codex    | Bekräftar att P3-specen kan upptäckas                                                           |
| 2026-04-25 | Lokal fullstack   | `npm run e2e:staging`                                                                        | Röd: 8/10 pass, 2 fail                                                | Codex    | Fail: Lantmäteriet-live saknas (`LIVE_LANTMATERIET_REQUIRED`) och `VERTEX_PROJECT_ID` saknas    |
| 2026-04-25 | Lokal browser     | `npx playwright test tests/e2e/staging-core-flows.spec.ts -g "Browser: hub"`                 | Pass: browserflöde renderar Core + fastighetskarta utan BankID        | Codex    | Playwright artefakter sparas i `test-results/` vid fel                                          |
| 2026-04-25 | Staging browser   | `PLAYWRIGHT_BASE_URL=<staging-ui> PLAYWRIGHT_API_BASE_URL=<staging-api> npm run e2e:staging` | Ej körd: `PLAYWRIGHT_BASE_URL` / `STAGING_URL` saknas i aktuell miljö | Codex    | Körs när staging-URL, adminsecret, Lantmäteriet-live och `VERTEX_PROJECT_ID` är satta i staging |

## Innehåll

- [Definitioner](#definitioner)
- [Del A – Process, GitHub och kvalitet](#del-a--process-github-och-kvalitet)
- [Del B – Infrastruktur och databas](#del-b--infrastruktur-och-databas)
- [Del C – Kärnsäkerhet och applikationsstart](#del-c--kärnsäkerhet-och-applikationsstart)
- [Del D – BankID](#del-d--bankid-slutanvändarinloggning)
- [Del E – Admin och organisation](#del-e--admin-och-organisation)
- [Del F – AI och dokumentintelligens](#del-f--ai-och-dokumentintelligens)
- [Del G – Sök, index och bakgrundsjobb](#del-g--sök-index-och-bakgrundsjobb)
- [Del H – Tillstånd och myndighetsinlämning](#del-h--tillstånd-och-myndighetsinlämning)
- [Del I – eIDAS / kvalificerad signatur](#del-i--eidas--kvalificerad-signatur)
- [Del J – Logistik och transport](#del-j--logistik-och-transport-produktion)
- [Del K – LIMS och fält](#del-k--lims-och-fält)
- [Del L – Observabilitet och incident](#del-l--observabilitet-och-incident)
- [Del M – Staging som sanning före prod](#del-m--staging-som-sanning-före-prod)
- [Del N – Juridik och produkt](#del-n--juridik-och-produkt-människa)
- [Del O – E-post och notifieringar](#del-o--e-post-och-notifieringar)
- [Del P – GCP / Cloud Run](#del-p--gcp--cloud-run-prod)
- [Del Q – Funktionssmoke](#del-q--funktionssmoke-done-moduler)
- [Del R – Övriga integrationer](#del-r--övriga-integrationer--scheman)
- [Snabbreferens PARTIAL](#snabbreferens-manifest-med-status-partial)
- [Bilaga A – Manifest-ID](#bilaga-a--feature-id-från-completionservice)
- [Bilaga B – Sign-off](#bilaga-b--sign-off)

Om ankarlänkarna inte hoppar korrekt i er Markdown-renderare (t.ex. p.g.a. `å/ä/ö` i rubriker), använd sökning i filen eller renderarens innehållsförteckning.

- [Versionshistorik](#versionshistorik)

---

## Definitioner

| Term                 | Betydelse                                                                                                                                                              |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **100 % på riktigt** | Funktionen använder **produktionstypiska** integrationer (riktiga API:er, certifikat, avtal) – **inte** mock, demo eller avsaknad av endpoint som ger syntetiska svar. |
| **Staging-klar**     | Samma som ovan men mot testcertifikat/testmiljöer där leverantören tillåter det.                                                                                       |
| **Måste**            | Blockerar trovärdig produktion för den del av produkten ni lovar kunder.                                                                                               |
| **Bör**              | Stark rekommendation (säkerhet, drift, juridik).                                                                                                                       |
| **Kan**              | Valfritt för vissa kunder; dokumentera om det är avstängt.                                                                                                             |

**Global regel för prod:** `BANKID_MOCK_MODE`, `LANTMATERIET_DEMO_MODE`, `LANTMATERIET_OPEN_MODE` (om ni kräver fastighetsdata), `DISPATCH_PROVIDER_MODE=MOCK_FRAKTBORS` och saknad `AUTHORITY_SUBMIT_ENDPOINT` är **inte** “100 % på riktigt” för respektive flöde.

---

## Del A – Process, GitHub och kvalitet

- [ ] **A1** `CODEOWNERS` uppdaterad med riktiga GitHub-användare/team (inte platshållare).
- [ ] **A2** Branch protection på default branch: kräv grön CI, minst en review, inga force-push.
- [ ] **A3** Secrets endast i GitHub Environments / Secret Manager – inga hemligheter i repo.
- [ ] **A4** `npm run qa` (eller motsvarande) grön lokalt före merge; CI speglar samma grindar.
- [ ] **A5** Staging-deploy ([`.github/workflows/deploy-staging.yml`](../../.github/workflows/deploy-staging.yml)) verifierad efter merge till `main`/`master`.
- [ ] **A6** Prod-deploy ([`.github/workflows/deploy-gcp.yml`](../../.github/workflows/deploy-gcp.yml)) med environment approval om tillämpligt.
- [ ] **A7** PR-mall och human-in-the-loop enligt `AGENTS.md` följs för ändringar i auth, persondata och myndighetsflöden.

---

## Del B – Infrastruktur och databas

- [ ] **B1** PostgreSQL med **PostGIS** och **pgvector** i prod (motsvarar CI-image och schema-kommentarer i `prisma/schema.prisma`).
- [ ] **B2** `DATABASE_URL` med korrekt SSL (`sslmode=require` i prod).
- [ ] **B3** `npx prisma migrate deploy` körs som del av deploy-pipeline mot rätt miljö.
- [ ] **B4** PostGIS-/spatial-SQL-migrationer (`prisma/spatial/` där tillämpligt) applicerade enligt er driftordlista.
- [ ] **B5** Backup-rutin: `BACKUP_DIR` eller `BACKUP_S3_BUCKET` (+ IAM) testad; återställningsövning dokumenterad.
- [ ] **B6** `CORS_ALLOW_ORIGINS` satt till **endast** era riktiga frontend-URL:er (inga wildcard i prod om policy säger nej).
- [ ] **B7** **Cloud SQL + Cloud Run:** instans skapad och kopplad via Unix-socket (`/cloudsql/CONNECTION_NAME`) enligt [deploy/gcp/README.md](../../deploy/gcp/README.md); Cloud Run-tjänsten har `--add-cloudsql-instances` motsvarande er `_CLOUDSQL_INSTANCE` (se även [cloudbuild.yaml](../../cloudbuild.yaml) substitutioner).

---

## Del C – Kärnsäkerhet och applikationsstart

- [ ] **C1** `JWT_ACCESS_SECRET` och `JWT_REFRESH_SECRET` starka, unika per miljö, roteringsplan beslutad.
- [ ] **C2** `SEARCH_ENCRYPTION_KEY_BASE64` satt och oförändrad utan medveten re-encrypt-plan.
- [ ] **C3** Lantmäteriet: **antingen** riktig autentisering **eller** medvetet beslut om `LANTMATERIET_OPEN_MODE` (då **fastighetsuppslag** enligt kod/status kan vara begränsat – se `fullStatusService` / manifest `geo-property-lookup`).
- [ ] **C4** `LANTMATERIET_DEMO_MODE=false` i prod om ni ska använda riktig fastighetsdata.
- [ ] **C5** `LANTMATERIET_LOOKUP_MODE`, `LANTMATERIET_BASE_URL`, `LANTMATERIET_OGC_COLLECTION` stämmer med avtalad API-produkt.
- [ ] **C6** SLU: `SLU_API_BASE_URL`, `SLU_API_KEY` (och ev. separata nycklar per del-API) satta om arter/observationer ska vara levande data.
- [ ] **C7** SGU: `SGU_DB_COVERAGE_MODE=complete` om full täckning krävs (annars dokumentera att “sample” används).
- [ ] **C8** VISS/Trafikverket: `VISS_API_KEY` / `TRAFIKVERKET_API_KEY` om respektive lager/flöden ska vara produktion mot extern källa.

---

## Del D – BankID (slutanvändarinloggning)

- [ ] **D1** Avtal och RP-certifikat hos BankID klara för **rätt miljö** (test vs prod).
- [ ] **D2** `BANKID_BASE_URL` pekar på rätt BankID-miljö.
- [ ] **D3** mTLS: `BANKID_PFX_PATH` + `BANKID_PFX_PASSPHRASE` **eller** `BANKID_CERT_PATH` + `BANKID_KEY_PATH` (+ ev. `BANKID_CA_PATH`) monterat i container/hemlighet.
- [ ] **D4** `BANKID_MOCK_MODE` **saknas eller är explicit `false`** i produktion.
- [ ] **D5** E2E eller manuell acceptans: full inloggning, session, utloggning, felvägar.
- [ ] **D6** CSRF och muterande anrop från frontend verifierade efter BankID-flöde (se `server/security/csrf.ts`).

---

## Del E – Admin och organisation

- [ ] **E1** `ADMIN_CONSOLE_USERNAME` / `ADMIN_CONSOLE_PASSWORD` (Secret Manager) – starkt lösenord, inte default.
- [ ] **E2** `ADMIN_ORG_NAME` / `ADMIN_ORG_NUMBER` stämmer med verklig administrativ organisation.
- [ ] **E3** Inbjudningsflöde (`JWT_SECRET` för org-invites om används) testat org-isolerat.
- [ ] **E4** Projektmedlemskap och rollbaserad åtkomst testat (inkl. nekad cross-org).

---

## Del F – AI och dokumentintelligens

- [ ] **F1** `GEMINI_API_KEY` (och ev. `VITE_GEMINI_API_KEY` om frontend anropar Gemini) – kvoter och billing övervakade.
- [ ] **F2** `OPENAI_API_KEY` om Core-verifiering/OpenAI används i prod.
- [ ] **F3** `GEMINI_DB_API_KEY` / `GEMINI_DB_ALLOW_REMOTE` enligt säkerhetsbeslut (ej remote i prod om policy säger nej).
- [ ] **F4** Embeddings: `EMBEDDING_MODEL`, `EMBEDDING_DIM`, timeout och fallback modeller verifierade mot er datavolym.
- [ ] **F5** OCR: `GEMINI_OCR_MODEL` eller `OCR_ENDPOINT` + `OCR_API_KEY` om extern OCR – test på representativa PDF.
- [ ] **F6** RAG och exec summary: representativa projekt testade (källor, hallisenering granskad av människa).

---

## Del G – Sök, index och bakgrundsjobb

- [ ] **G1** `SEARCH_WORKER_ENABLED=true` i prod om indexeringsjobb ska köras (eller separat worker enligt arkitektur).
- [ ] **G2** Sökjobb: uppladdning → jobbstatus → sökresultat verifierat ända fram.
- [ ] **G3** Disk/lagring för dokument (`documentUploadService` / konfigurerade sökvägar) har tillräcklig volym och backup.
- [ ] **G4** Outlook-ingest (**PARTIAL** i manifest): Microsoft Graph-app, `OUTLOOK_WEBHOOK_SECRET`, lagringsvägar (`OUTLOOK_*`, `LOCAL_DB_ROOT`) – **endast bocka om ni faktiskt ska läsa mail i prod**.

---

## Del H – Tillstånd och myndighetsinlämning

- [ ] **H1** `AUTHORITY_SUBMIT_ENDPOINT` satt till **riktig** mottagar-URL (inte mock).
- [ ] **H2** Autentisering mot myndighets-API enligt `server/services/permitAuthorityAdapter.ts`: `AUTHORITY_API_KEY` och/eller `AUTHORITY_BEARER_TOKEN`, samt `AUTHORITY_SUBMIT_AUTH_MODE` om mottagaren kräver specifikt läge.
- [ ] **H3** Robusthet: `AUTHORITY_SUBMIT_TIMEOUT_MS` och `AUTHORITY_SUBMIT_MAX_RETRIES` satta enligt mottagarens SLA och er timeout-policy.
- [ ] **H4** Manuellt test: ansökan genereras, skickas, svar/diarienummer spåras i UI och `AuditTrail`.
- [ ] **H5** Juridisk granskning av innehåll i ansökan innan “levande” inlämning.

---

## Del I – eIDAS / kvalificerad signatur

- [ ] **I1** `EIDAS_QTSP_ENDPOINT` och `EIDAS_QTSP_API_KEY` (**PARTIAL** i manifest) – avtal med QTSP (t.ex. Assently/Scrive) klart.
- [ ] **I2** Testsignering i staging med riktigt QTSP-testkonto.
- [ ] **I3** BankID-baserade signaturer i avloppsflöden (`digitalsignatureService`) skiljs från eIDAS-flöden i testplan.

---

## Del J – Logistik och transport (produktion)

- [ ] **J1** `DISPATCH_PROVIDER_MODE` satt till `TIMOCOM` eller `TRANS_EU` – **inte** `MOCK_FRAKTBORS` (kod blockerar mock i operativ drift).
- [ ] **J2** `TIMOCOM_API_KEY` eller `TRANS_EU_API_KEY` satt och offert/bokning testad.
- [ ] **J3** GPS-spårning och förarjournal (inkl. signaturflöden) testade mot minst ett riktigt bokningsscenario.
- [ ] **J4** `MARKET_INTEL_ENDPOINT` om marknadspriser ska vara externa (annars dokumentera fallback).

---

## Del K – LIMS och fält

- [ ] **K1** `LIMS_API_ENDPOINT` + `LIMS_API_KEY` (**PARTIAL** i manifest) – automatisk hämtning testad mot labbmiljö.
- [ ] **K2** PWA/fält (**PARTIAL** i manifest): acceptanstest på mobil, ev. offline – dokumentera kända begränsningar eller bocka när E2E finns.

---

## Del L – Observabilitet och incident

- [ ] **L1** `SENTRY_DSN` satt; testfel syns i Sentry utan PII-läckage.
- [ ] **L2** `METRICS_BEARER_TOKEN` satt om `/metrics` ska skyddas.
- [ ] **L3** `/health` används av lastbalanserare/Cloud Run; larm vid 503.
- [ ] **L4** Loggretention och åtkomst till loggar (GCP) dokumenterad.
- [ ] **L5** **Google Cloud Logging:** loggar från Cloud Run sökbara; minst ett **larm eller manuell rutin** (t.ex. felkvot, 5xx-tröskel) dokumenterad – kompletterar Sentry, ersätter den inte.

---

## Del M – Staging som “sanning” före prod

- [ ] **M1** `.env.staging` / GitHub `staging` environment speglar prod **utan** prod-nycklar.
- [ ] **M2** `docker-compose.staging.yml` (nämns i manifest `infra-staging`) eller motsvarande körbar med migreringar.
- [ ] **M3** Genomgång av `GET /api/admin/app-status` och ev. `full-status` i staging med alla integrationer “gröna” eller medvetet dokumenterade undantag.
- [ ] **M4** `GET /api/admin/completion` i `server/secureApi.express.ts` anropas med **giltig admin-autentisering** (`requireAuth`). Svaret kommer från `getAppCompletion()` i `server/services/completionService.ts`. **PARTIAL**-punkter är antingen åtgärdade eller **skriftligt accepterade** med datum och ansvarig.

---

## Del N – Juridik och produkt (människa)

- [ ] **N1** Personuppgiftsbiträdesavtal, registerbeskrivning och rutiner för GDPR-export/radering (`gdprComplianceService`) genomgångna.
- [ ] **N2** Villkor och ansvarsfriskrivning för AI-genererat innehåll kommunikerade till användare.
- [ ] **N3** Go/no-go-möte: checklista **A–R** (inkl. bilagor vid formell sign-off) genomgången och signerad av ansvarig produkt + teknik.

---

## Del O – E-post och notifieringar

Stage-gate- och medlemsnotiser loggas alltid i `AuditTrail`; **e-post** kräver SMTP (se `notificationService` / manifest `project-notifications`).

- [ ] **O1** `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS` satta om e-post ska skickas i prod.
- [ ] **O2** `SMTP_PORT` och `SMTP_SECURE` stämmer med er leverantör (t.ex. 587 + STARTTLS).
- [ ] **O3** `NOTIFICATION_FROM_EMAIL` är en adress ni äger och som passerar SPF/DKIM enligt policy.
- [ ] **O4** Test: trigga händelse som skickar notis (t.ex. stage-gate) och verifiera mottagen e-post i staging.

---

## Del P – GCP / Cloud Run (prod)

Stäm av **Secret Manager** och **Cloud Run** mot era pipelines.

**Cloud Build** ([cloudbuild.yaml](../../cloudbuild.yaml)) monterar bland annat (via `--update-secrets`): `DATABASE_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `GEMINI_API_KEY`, `OPENAI_API_KEY`, `BANKID_PFX_PASSPHRASE`, `LANTMATERIET_API_KEY`, `SLU_API_KEY`, `SEARCH_ENCRYPTION_KEY_BASE64`, `ADMIN_CONSOLE_PASSWORD`.

**GitHub Actions prod** ([deploy-gcp.yml](../../.github/workflows/deploy-gcp.yml)) använder motsvarande samt `CORS_ALLOW_ORIGINS` via repository variable `GCP_CORS_ORIGINS` och health check mot `GCP_SERVICE_URL`.

- [ ] **P1** Alla hemligheter som deploy-flödet förväntar sig finns i Secret Manager med rätt namn och version.
- [ ] **P2** `DATABASE_URL` i Secret Manager använder Cloud SQL-socket-format som appen stödjer i prod.
- [ ] **P3** Service account och IAM för Cloud Run + Cloud SQL är minsta behörighet och dokumenterade.
- [ ] **P4** `GCP_CORS_ORIGINS` / motsvarande env speglar endast tillåtna webborigins.
- [ ] **P5** Efter deploy: manuell eller automatisk hälsokontroll mot prod-URL enligt pipeline.

---

## Del Q – Funktionssmoke (DONE-moduler)

Korta **end-to-end**- eller **UI+API**-tester i **staging** (uppdatera vid behov mot er produktscope). Syfte: verifiera att modulerna hänger ihop, inte bara att en env-variabel finns.

**Projekt och plan**

- [ ] **Q1** Skapa projekt, välj mall, spara projektplan, öppna Gantt.
- [ ] **Q2** Stage-gates: trigga utvärdering och verifiera status i UI + audit.
- [ ] **Q3** Koldioxidberäkning och prediktiva poäng visas utan fel för testprojekt.
- [ ] **Q4** Projektmedlemmar: bjuda in, acceptera, ändra roll, neka cross-org åtkomst.

**Tillstånd och krav**

- [ ] **Q5** Kravfall, citat, AI-verifiering och kravrapporter (CSV/DOCX) för testdata.
- [ ] **Q6** Ansökningsguide (wizard) och DOCX-export av ansökan.
- [ ] **Q7** `GET /api/permits` / tillståndslista i UI speglar databas (efter seed eller testdata).

**Geodata**

- [ ] **Q8** Karta, SGU/NVR/hydro-lager och spatial audit för känt testområde.
- [ ] **Q9** Fastighetsuppslag (om **inte** endast demo-läge) med riktig LM-data.
- [ ] **Q10** Marktäcke och 3D-terräng (inkl. fallback om extern endpoint saknas).

**Sök och dokument**

- [ ] **Q11** Filuppladdning, indexjobb, fulltextsök och filter.
- [ ] **Q12** RAG-sök och exekutiv sammanfattning (kö + resultat granskat av människa).

**Logistik** (efter att J1–J2 är uppfyllda)

- [ ] **Q13** Offert, bokning, GPS-poster, förarjournal (inkl. signaturflöde enligt scope).

**Compliance**

- [ ] **Q14** Revisionsexport, regelmotor, GDPR-rutiner i UI/API enligt er process.
- [ ] **Q15** Checklist-RAG för representativt projekt.

**Admin**

- [ ] **Q16** `app-status` / `full-status`, completion-tracker, DB-stats, `/metrics` (med token om satt), backup-trigger i kontrollerad miljö.

---

## Del R – Övriga integrationer / scheman

- [ ] **R1** **Domstol RSS:** i `GET` full-status (eller motsvarande admin-svar) kontrollera att `domstolRssScheduler` visar förväntat intervall och att senaste körning inte permanent felar – om ni använder schemalagd rättspraxis-ingest.
- [ ] **R2** **Kommunal data:** om ni använder kommunala flöden, sätt och verifiera `MUNICIPAL_CONTACTS_CSV_PATH`, `MUNICIPAL_DIARIES_INDEX_URL` (eller dokumentera N/A).
- [ ] **R3** **Rättsfallsingest / legal sources:** representativt ingest- eller söktest om det ingår i er prod-scope.

---

## Snabbreferens: manifest med status PARTIAL

Dessa kräver extra miljö/avtal eller acceptans enligt `completionService.ts`:

| ID                             | Område                                                                                                               |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `auth-bankid`                  | Cert + `BANKID_*`, mock av i prod                                                                                    |
| `permit-authority-submit`      | `AUTHORITY_SUBMIT_ENDPOINT`, auth (`AUTHORITY_API_KEY` / `AUTHORITY_BEARER_TOKEN`), ev. `AUTHORITY_SUBMIT_AUTH_MODE` |
| `compliance-digital-signature` | `EIDAS_QTSP_*`                                                                                                       |
| `geo-property-lookup`          | Riktig Lantmäteriet-auth (ej bara demo/open)                                                                         |
| `search-outlook-ingestion`     | Microsoft Graph + webhook + lagring                                                                                  |
| `field-lims-integration`       | `LIMS_*`                                                                                                             |
| `field-mobile-app`             | Mobilacceptans / E2E                                                                                                 |
| `infra-staging`                | Staging helt verifierad med riktiga integrationer där krav finns                                                     |

---

## Bilaga A – Feature-ID från completionService

Källfil: `server/services/completionService.ts`. Kolumnen **Verifiering** anger rekommenderad primär metod; flera kan kombineras.

| Feature-ID                      | Manifeststatus | Verifiering                          |
| ------------------------------- | -------------- | ------------------------------------ |
| `auth-bankid`                   | PARTIAL        | Manuell + integration (riktigt cert) |
| `auth-admin-console`            | DONE           | Smoke                                |
| `auth-token-refresh`            | DONE           | Integration                          |
| `auth-org-management`           | DONE           | Smoke + manuell                      |
| `project-create`                | DONE           | Smoke                                |
| `project-plan-save`             | DONE           | Smoke                                |
| `project-stage-gates`           | DONE           | Smoke + manuell                      |
| `project-carbon-calc`           | DONE           | Smoke                                |
| `project-template`              | DONE           | Smoke                                |
| `project-map-layers`            | DONE           | Smoke                                |
| `project-predictive-scores`     | DONE           | Smoke                                |
| `project-gantt`                 | DONE           | Smoke                                |
| `project-member-roles`          | DONE           | Integration                          |
| `project-notifications`         | DONE           | Manuell (e-post om SMTP)             |
| `permit-portal-view`            | DONE           | Smoke                                |
| `permit-docx-export`            | DONE           | Manuell                              |
| `permit-requirements-cases`     | DONE           | Smoke                                |
| `permit-requirements-citations` | DONE           | Smoke + manuell (AI)                 |
| `permit-requirements-reports`   | DONE           | Manuell                              |
| `permit-application-wizard`     | DONE           | Smoke                                |
| `permit-authority-submit`       | PARTIAL        | Integration + manuell                |
| `logistics-dispatch-quote`      | DONE           | Integration (efter J1–J2)            |
| `logistics-transport-booking`   | DONE           | Integration                          |
| `logistics-driver-journal`      | DONE           | Manuell                              |
| `logistics-lims-ingest`         | DONE           | Smoke                                |
| `logistics-market-view`         | DONE           | Smoke                                |
| `logistics-gps-tracking`        | DONE           | Integration                          |
| `compliance-audit-export`       | DONE           | Manuell                              |
| `compliance-rule-engine`        | DONE           | Integration                          |
| `compliance-gdpr`               | DONE           | Manuell                              |
| `compliance-checklist-rag`      | DONE           | Manuell                              |
| `compliance-executive-summary`  | DONE           | Manuell                              |
| `compliance-digital-signature`  | PARTIAL        | Integration (QTSP)                   |
| `geo-map-view`                  | DONE           | Smoke                                |
| `geo-sgu-layers`                | DONE           | Smoke                                |
| `geo-hydro-layers`              | DONE           | Smoke                                |
| `geo-nvr`                       | DONE           | Smoke                                |
| `geo-property-lookup`           | PARTIAL        | Integration                          |
| `geo-spatial-audit`             | DONE           | Smoke                                |
| `geo-markcover`                 | DONE           | Smoke                                |
| `geo-3d-terrain`                | DONE           | Smoke                                |
| `search-sync`                   | DONE           | Integration                          |
| `search-query`                  | DONE           | Smoke                                |
| `search-status`                 | DONE           | Smoke                                |
| `search-outlook-ingestion`      | PARTIAL        | Integration                          |
| `search-ocr`                    | DONE           | Manuell                              |
| `ai-gemini-integration`         | DONE           | Manuell                              |
| `ai-core-gateway`               | DONE           | Manuell                              |
| `ai-knowledge-graph`            | DONE           | Smoke                                |
| `ai-requirement-extraction`     | DONE           | Manuell                              |
| `ai-rag-search`                 | DONE           | Manuell                              |
| `field-sampling-prep`           | DONE           | Smoke                                |
| `field-lims-integration`        | PARTIAL        | Integration                          |
| `field-mobile-app`              | PARTIAL        | Manuell / E2E                        |
| `admin-app-status`              | DONE           | Smoke                                |
| `admin-db-stats`                | DONE           | Smoke                                |
| `admin-db-contents`             | DONE           | Smoke                                |
| `admin-completion`              | DONE           | Smoke (admin-auth)                   |
| `admin-monitoring`              | DONE           | Integration                          |
| `admin-error-tracking`          | DONE           | Integration                          |
| `admin-backup`                  | DONE           | Manuell                              |
| `doc-file-upload`               | DONE           | Integration                          |
| `permit-list-api`               | DONE           | Smoke                                |
| `infra-staging`                 | PARTIAL        | Manuell                              |

---

## Bilaga B – Sign-off

| Miljö      | Datum | Namn | Roll | Signatur / e-postbekräftelse |
| ---------- | ----- | ---- | ---- | ---------------------------- |
| Staging    |       |      |      |                              |
| Produktion |       |      |      |                              |

---

## Versionshistorik

| Datum      | Ändring                                                                                                                                                                                                                                                                                                                                                                             |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-04-06 | Första version (`completionService` + `.env.example`). Utökad samma dag: innehållsförteckning, N3 → checklista A–R, B7 Cloud SQL, H2–H5 myndighets-auth (`permitAuthorityAdapter`), L5 Cloud Logging, M4 (`requireAuth` + `getAppCompletion()`), Del O (SMTP), P (Secret Manager / `cloudbuild.yaml` / `deploy-gcp.yml`), Q (modul-smoke), R (Domstol RSS, kommunalt), bilagor A–B. |
