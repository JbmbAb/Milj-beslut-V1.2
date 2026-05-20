# Implementeringsplan: Tre fokusmoduler (rev. kodbas 2026-05)

Detta dokument ersätter den tidigare grovplanen. Det är avstämt mot faktisk kod i repo, `AGENTS.md` och `docs/qa/STAGING_ONLY_PLAN.md`.

**Staging är godkännandemiljö.** Lokal körning är utveckling/debug. Mock/demo ska vara avstängt i staging.

---

## Målbild

| Modul | Mål | Canonical backend | Canonical UI |
| ----- | --- | ----------------- | ------------ |
| **Enskilt avlopp** | Eget flöde: ansökan → validering → underlag → export/submission → status → audit | `server/routes/sewage.routes.ts` + `server/services/sewageApplicationService.ts` | `components/admin/modules/sewage-portal/*` |
| **C-anmälan schaktmassor** | Eget flöde: fastighet → MPF/EWC (+ senare SNI) → mellanlagring/deponi → underlag → export/submission → audit | `server/routes/cNotificationMass.routes.ts` | **Ny** UI (inte `CNotificationUI.tsx`) |
| **Lokaliseringsutredning** | Eget flöde: platsval → geodata → regel/risk → beslutsunderlag → PDF/JSON → audit | `server/services/localization.routes.ts` → flytt till `server/routes/` | `components/LocalizationStudyUI.tsx` |

**C-anmälan kemikalier** (`CNotificationUI.tsx`, `services/cnotificationChemicalApi.ts`) är en **annan produktmodul** och ingår inte i denna plan.

---

## Nuläge (fakta från repo)

### Routing — single source of truth

- **Produktion/test:** `server/createApp.ts` (används av `server/index.ts`, integrationstester, E2E-setup).
- **Legacy `server/services/createApp.ts`:** borttagen ur aktiv drift.

Registrering i huvud-app (2026-05-20):

```text
app.use(sewageApplicationsRouter);  // server/routes/sewage.applications.routes.ts  ← canonical CRUD
app.use(sewageDocumentRouter);      // server/routes/sewage.routes.ts             ← submit/signatur/webhook
app.use(cNotificationMassRouter);   // server/routes/cNotificationMass.routes.ts
app.use(localizationRouter);        // server/routes/localization.routes.ts
app.use(adminV1Router);             // GET /api/sewage-applications (deprecated list); POST → 410
```

### Enskilt avlopp — splittrad implementation

| Yta | Paths | Status |
| --- | ----- | ------ |
| `sewage.routes.ts` | submit, status (501 om statuskälla saknas), history, audit, BankID, webhook | Delvis produktionsklar |
| `admin.v1.routes.ts` | `/api/sewage-applications` (GET/POST) | Mock/hårdkodade koordinater, projekt-proxy |
| E2E `staging-enskilt-avlopp.spec.ts` | `/api/sewage/applications` (+ status/export) | **Implementerat** — kör `npm run e2e:staging:avlopp` mot staging |
| `sewageApplicationService.ts` | create, validate, persistens | Finns; **inte fullt exponerad** via canonical routes |
| Enhetstester | `adminSewageApplicationRoutes.test.ts` | Testar `/api/sewage/application/*` som **inte är monterade** (describe block kommenterad) |

**Slutsats Fas 1:** Konsolidera till **ett API-kontrakt** innan nya features.

### C-anmälan schaktmassor — canonical API implementerat (2026-05-20)

- Full kedja i `cNotificationMass.routes.ts` + `massOrchestrator.ts` + `CNotificationMassUI.tsx`.
- `POST /api/c-notification/mass/validate-codes` (MPF/EWC via `mpfThresholdService.ts`, valfri SNI).
- `massFlowService.ts` ligger i `server/repositories/` (inte `services/`).
- `logisticsGeneratorService.ts` finns men är **inte kopplad** till mass-routen.
- `server/services/c-notification.routes.ts` är stub (`TODO`, `console.log`) — **inte** i huvud-`createApp`.

### Lokaliseringsutredning — routes finns, hårdning saknas

- `POST /api/localization/generate-report`
- `POST /api/localization/generate-pdf-data`
- `localizationReportService.ts` har placeholder för artskydd/SLU.
- `seed-localization-demo.ts` — risk för demo-fallback; ska inte användas i staging-bevis.
- Generisk PDF: `server/routes/pdf-export.routes.ts` (`/api/export/pdf-json`).

### Staging/QA — redan på plats

- Policy: `AGENTS.md`, `docs/qa/STAGING_ONLY_PLAN.md`
- PR-gate: `.github/workflows/staging-proof-gate.yml`
- E2E avlopp: `tests/e2e/staging-enskilt-avlopp.spec.ts` (kräver path-fix i Fas 1)
- C-anmälan: **egen E2E-spec saknas** (noterat i STAGING_ONLY_PLAN)

---

## Canonical API (målkontrakt efter Fas 0–3)

Prefix: alla modulroutes under `/api/...`, `requireAuth`, `rateLimitByUser` där mutering, `assertProjectAccess` / org-scoping där `projectId` finns.

### Enskilt avlopp (`/api/sewage/applications`)

| Metod | Path | Syfte |
| ----- | ---- | ----- |
| POST | `/api/sewage/applications` | Skapa utkast |
| GET | `/api/sewage/applications/:id` | Hämta |
| PATCH | `/api/sewage/applications/:id` | Uppdatera utkast |
| POST | `/api/sewage/applications/:id/validate` | Validering (regler + obligatoriska fält) |
| POST | `/api/sewage/applications/:id/generate-documents` | Underlag (→ `sewageDocumentGenerator`) |
| GET | `/api/sewage/applications/:id/export` | Exportpaket |
| POST | `/api/sewage/applications/:id/submit` | Submission (ersätter/adaptrar nuvarande submit) |
| PATCH | `/api/sewage/applications/:id/status` | Interna statusövergångar (utkast → validerad → skickad → …) |
| GET | `/api/sewage/applications/:id/status-history` | Historik |
| GET | `/api/sewage/applications/:id/audit-trail` | Audit |

**Avveckla:** `/api/sewage-applications` i `admin.v1.routes.ts` (eller gör tunt proxy → canonical tills frontend migrerat).

**Behåll separat (om municipality-integration):** webhook `/api/sewage/webhooks/municipality-status`, BankID-signaturvägar — men med konsekvent `/api`-prefix.

### C-anmälan schaktmassor (`/api/c-notification/mass`)

| Metod | Path | Syfte |
| ----- | ---- | ----- |
| POST | `.../property-search` | Fastighetssök (→ befintlig property lookup-integration) |
| POST | `.../validate-codes` | **Finns** — MPF + EWC obligatoriskt; SNI valfritt (fas 2 fördjupning) |
| POST | `.../operations` | Skapa/uppdatera delbeslut mellanlagring/deponi |
| POST | `.../mass-flow` | Massflöde (→ `server/repositories/massFlowService.ts`) |
| POST | `.../logistics` | Logistikunderlag (→ `logisticsGeneratorService.ts`) |
| POST | `.../generate-documents` | Underlag |
| GET | `.../export` | Export |
| POST | `.../submit` | Submission |
| GET | `.../:caseId/audit-trail` | Audit |

Gate-beslut: deterministiskt från `evaluateMpfCode` (EWC först; SNI som komplettering, inte gate-veto i fas 1).

### Lokaliseringsutredning (`/api/localization`)

| Metod | Path | Syfte |
| ----- | ---- | ----- |
| POST | `/api/localization/generate-report` | **Finns** — rapport + audit |
| POST | `/api/localization/generate-pdf-data` | **Finns** — PDF-data |
| POST | `/api/localization/export-pdf` | Valfritt: direkt PDF via `pdf-export.routes` eller samlad route |

**Krav staging:** Ingen tyst degradering när livekällor (SLU, NVR, SGU, …) saknas — explicit fel/warning i svar.

---

## Faser

### Fas 0: Stabil bas (1–2 dagar) — BLOCKER

**Mål:** En app, en route-tabell, inga falska dubletter.

1. **Dokumentera route-register** i detta dokument (uppdatera tabell vid varje PR).
2. **Avveckla eller märk deprecated:** `server/services/createApp.ts`, `server/services/c-notification.routes.ts`.
3. **Besluta canonical paths** (tabell ovan) — skriv ADR-lik notis i PR om avvikelse.
4. **Path-audit:** lista alla `sewage`/`c-notification`/`localization`-paths i repo; markera vilka som tas bort.
5. **Staging gate:** bekräfta `staging-proof-gate.yml` + `npm run smoke:staging-verify` i CI.
6. **Flytt (valfritt men rekommenderat):** `localization.routes.ts` → `server/routes/localization.routes.ts`, uppdatera import i `createApp.ts`.

**Definition of done**

- [x] Endast `server/createApp.ts` mountar modulroutes i prod/test.
- [x] Route-tabell i detta doc matchar `createApp.ts`.
- [x] `localization.routes.ts` ligger under `server/routes/` med korrekta service-imports.
- [x] POST `/api/sewage-applications` returnerar 410 med pekare till canonical API.
- [ ] Inga nya features på deprecated paths (pågående disciplin).

---

### Fas 1: Enskilt avlopp (3–5 dagar)

**Mål:** Ett flöde, staging-E2E grön, audit på kritiska steg.

1. Implementera canonical `/api/sewage/applications/*` i `sewage.routes.ts` (eller ny `sewage.applications.routes.ts` monterad från samma modul).
2. Koppla till `sewageApplicationService.ts` + `sewageDocumentGenerator.ts` / `sewageDocumentGeneratorService.ts`.
3. Persistens + statusmaskin (utkast → validerad → skickad + municipality-status när konfigurerad).
4. Migrera `SewagePortalView` / hooks till canonical API.
5. Deprecate/remove mock i `admin.v1.routes.ts` för sewage.
6. Uppdatera `tests/e2e/staging-enskilt-avlopp.spec.ts` endast om kontrakt ändras (mål: inga path-ändringar — implementera det E2E redan förväntar).
7. Route-tester: `tests/unit/sewageRoutes.test.ts` + utökning för applications CRUD.

**Acceptance criteria**

- [ ] Utkast → validerad → skickad med spårbar `applicationId` och `projectId`.
- [ ] Export kopplad till användare/org.
- [ ] Audit trail för validate, generate, submit.
- [ ] `npm run e2e:staging:avlopp` passerar mot staging (mock av).

---

### Fas 2: C-anmälan schaktmassor (4–6 dagar)

**Mål:** Full kedja från fastighet till submission; separata delbeslut.

1. Utöka `cNotificationMass.routes.ts` enligt canonical tabell.
2. Fas 2a (obligatorisk): MPF + EWC via `mpfThresholdService.ts`; `operationType`: `MELLANLAGRING` | `DEPONI`.
3. Fas 2b: SNI som fördjupning (påverkar inte primär gate i v1).
4. Integrera `massFlowService.ts` + `logisticsGeneratorService.ts`.
5. **Ny frontend:** t.ex. `components/CNotificationMassUI.tsx` (eller modul under `components/admin/modules/`) — **inte** återanvänd kemikalie-UI.
6. Property search: återanvänd `propertyLookupRouter` / geo-klienter.
7. Enhetstester: utöka `tests/unit/cNotificationMassRoutes.test.ts`; service-tester för massflöde/logistik.
8. **Ny** `tests/e2e/staging-c-anmalan-mass.spec.ts` för STAGING_ONLY_PLAN punkt C-anmälan.

**Acceptance criteria**

- [ ] Mellanlagring och deponi som separata beslut med egna gate outcomes.
- [ ] Export/submission innehåller mottagare, klassning, kapacitet, transportkedja.
- [ ] Deterministisk gate från EWC (+ dokumenterad SNI-roll).
- [ ] Staging-bevis dokumenterat i PR.

---

### Fas 3: Lokaliseringsutredning (3–5 dagar)

**Mål:** Staging utan demo-fallback; reproducerbar PDF/JSON.

1. Hårda `localizationReportService.ts` (SLU/artskydd — inga tysta placeholders i staging).
2. Säkerställ audit på generate-report och export.
3. Koppla `LocalizationStudyUI.tsx` till färdiga fel/warning-kontrakt (meta från geodata-lager).
4. Verifiera PDF-kedja: `generate-pdf-data` + vid behov `/api/export/pdf-json`.
5. Granska/radera beroende på `seed-localization-demo.ts` i staging builds.
6. Route-tester + utökad E2E (befintlig core-flow eller ny spec).

**Acceptance criteria**

- [ ] Platsval → geodata → regel/risk → beslutsunderlag utan demo-fallback.
- [ ] PDF/JSON reproducerbara; audit loggad.
- [ ] Human-in-the-loop-text i AI-genererade underlag (staging-check).

---

### Fas 4: Kodsanering (2–4 dagar, parallellt med 1–3)

- Ta bort eller arkivera: `server/services/createApp.ts`, stub `c-notification.routes.ts`.
- Eliminera döda route-registreringar och inkonsekventa path-prefix (`/sewage/...` vs `/api/sewage/...`).
- Minska `any` i localization routes (`req as any` → `req.authUser`).
- Ersätt `console.log` med `logger` i berörda moduler.
- Säkerhetsstäd: verifiera `auth.ts`, `csrf.ts`, `rateLimit.ts`, `secureErrors.ts` på **nya** endpoints.
- `.env.example` / `.env.test.example`: inga osäkra exempelhemligheter; dokumentera staging-variabler.

---

### Fas 5: Test och QA-bevis (3–5 dagar)

| Typ | Fokus |
| --- | ----- |
| Unit | Route-tester alla tre moduler; `mpfThresholdService`, statusövergångar, dokumentgenerering |
| Integration | Full kedja per modul med test-DB |
| E2E staging | `e2e:staging:avlopp`, ny mass-spec, localization i `e2e:staging:all` + `staging:verify` |

**DoD**

- [ ] Bevislänkar i PR (staging-proof-gate).
- [ ] Mock/demo av i staging.
- [ ] Human-in-the-loop i AI-underlag.

---

### Fas 6: Dokumentation (2–3 dagar)

Uppdatera:

- `docs/qa/STAGING_ONLY_PLAN.md` (paths, nya E2E-specs)
- `.github/pull_request_template.md`
- Modulgränser + API-kontrakt (detta dokument + länk från `modulregister_ombyggnad.md`)
- Miljövariabler + testkörning (`npm run qa`, `e2e:staging:*`)
- **Migreringsnotis:** vad som ersatts (`/api/sewage-applications`, stub c-notification, legacy createApp)

---

## Exekveringsordning

### Implementation (bygg)

```text
Fas 0 → Fas 1 (avlopp) → Fas 2 (schaktmassor) → Fas 3 (lokalisering)
         ↘ Fas 4 (löpande parallellt) ↙
Fas 5 → Fas 6
```

**Motivering:** Avlopp har mest befintlig kod men värsta path-split; schaktmassor är minst implementerat; lokalisering har routes men behöver datahårdning.

### Staging-bevis (verifiera) — enligt `STAGING_ONLY_PLAN.md`

```text
Lokaliseringsutredning → C-anmälan schaktmassor → Enskilt avlopp
```

Detta är **inte** motsägelse: bygg i implementation-ordning, bevisa i staging-ordning när varje modul är klar.

---

## Riskregister (kort)

| Risk | Åtgärd |
| ---- | ------ |
| E2E avlopp failar tills `/api/sewage/applications` finns | Fas 1 prioritet 1 |
| Förvirring kemikalier vs schaktmassor | Separat UI + API-prefix `/mass/` |
| Dubbel createApp | Fas 0 raderar/deprecar legacy |
| Status 501 på municipality | Dokumentera env för statuskälla; tydligt fel i staging |
| Demo seed localization | Fas 3 + staging-verify |

---

## Referenser

- `docs/qa/STAGING_ONLY_PLAN.md`
- `server/createApp.ts`
- `AGENTS.md` (staging-only, modularitet)
- `docs/architecture/modulregister_ombyggnad.md`

---

*Senast reviderad: 2026-05-20 — baserad på kodgranskning av recovery-workspace.*
