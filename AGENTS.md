# Arbetssätt
- Kör aldrig full omindexering utan explicit godkännande.
- Tolka frågor som frågor, inte som körorder.
- Bekräfta innan jobb som kan ta mer än 5 minuter.
- Om något verkar ologiskt: stoppa och fråga.

# Kvalitetskrav
- All programmering måste vara juridiskt hållbar.
- Human in the loop ska finnas i alla steg.

---

# Arbetsfördelning: fyra verktyg

## 🤖 GitHub Copilot agent ("här") — PR-driven automation
**Passar för**: allt som kan automatiseras, verifieras med tester och committas direkt.

### Gör det här:
| Uppgift | Varför |
|---|---|
| TypeScript-fel (0 fel nu ✅) | Kan köra `npx tsc --noEmit` för att verifiera |
| Lint-fel (0 fel nu ✅) | Kan köra `npx eslint .` för att verifiera |
| Säkerhetsluckor i backend | Kan analysera + patcha + testa |
| Ny API-endpoint | Kan skriva handler + test i samma PR |
| Refaktorering av services | Stödjer sig mot befintliga tester |
| CI/CD-fixar (workflow, Docker) | Inga interaktiva beroenden |
| Testskrivning (Vitest, Playwright) | Kan köra och verifiera resultatet |
| README/AGENTS.md | Dokumentation utan externa beroenden |
| Miljövariabel-granskning | Kan söka i kod utan att exponera hemligheter |

### Gör INTE det här:
- Ändra Figma-design (ingen canvas-access)
- Köra `npm run dev` i bakgrunden för manuell UI-test
- Hantera AWS/Sentry-credentials i produktion
- Godkänna juridiska/compliance-beslut (human-in-the-loop)

---

## 🎨 Figma Make / "Antigravity" — UI-design och komponentprototyper
> **"Antigravity"** är det interna projektnamnet för Figma Make-integrationen i detta repo.

**Passar för**: visuell layout, designtokens, komponentstruktur — INNAN kod skrivs.

### Gör det här:
| Uppgift | Varför |
|---|---|
| Ny UI-vy från scratch | Figma Make genererar React-komponenter direkt från Figma-frames |
| Uppdatera `tokens.json` / `tokens.css` | Designsystemets färger, spacing, typografi |
| Prototypa `ApplicationWizard`, `PermitPortalView` | Snabb visuell iteration |
| Generera komponentstruktur från `figma_make_context_manifest.md` | Filen anger rätt importordning |
| Skapa mockups för myndighetssubmission-UI | Inga befintliga komponenter |

**Importordning till Figma Make** (se `figma_make_context_manifest.md`):
1. `types.ts` → `constants.ts` → `index.tsx` → `components/App.tsx`
2. `tokens.json` + `tokens.css`
3. Relevanta komponentfiler

### Gör INTE det här:
- Backend-logik (services, repositories, API-routes)
- Databasschema eller Prisma-migrationer
- Säkerhetskod (auth, rate limiting)

---

## 🧪 Google AI Studio — prompt-tuning och AI-pipeline

**Passar för**: interaktiv finjustering av Gemini-promptar och analys av rättsliga dokument.

### Gör det här:
| Uppgift | Varför |
|---|---|
| Finjustera system-promptar (gemini-2.5-pro/flash) | Interaktivt promptlab utan kodingrepp |
| Analysera miljödomar och tillståndsbeslut (PDF) | 1M tokens kontextfönster, stöder PDF-upload direkt |
| Prototypa strukturerade JSON-svar (`application/json`-läge) | Se exakt vad tjänsterna returnerar |
| Testa embedding-modeller (`gemini-embedding-001`) | Verifiera sökkvalitet innan deploy |
| Generera svenska testdata med å/ä/ö + SWEREF99-koordinater | Snabbare än att skriva för hand |

**Importordning till AI Studio** (se `ai_studio_context_manifest.md`):
- Session 1 (kravanalys): `types.ts` → `server/schemas/mvpSchemas.ts` → `server/services/mvpAiGatewayService.ts`
- Session 2 (RAG): `types.ts` → `server/services/ragSearchService.ts`
- Session 3 (dokumentanalys): `types.ts` → `server/services/documentGenerator.ts` + PDF-upload

**Redo att använda prompts**: se `AI_STUDIO_PROMPT.md`

### Gör INTE det här:
- Ladda upp `.env`, certifikat eller riktiga personuppgifter
- Ersätt produktionskod utan TS/lint-verifiering från Copilot agent
- Använd för UI-komponent-generering (hellre Figma Make / Stitch)

---

## 💻 GitHub Copilot / Codex i VS Code — lokal feature-implementation
**Passar för**: interaktiv feature-utveckling med full IDE-kontext.

### Gör det här:
| Uppgift | Varför |
|---|---|
| Implementera `POST /api/documents/upload` | Kräver lokal server + DB för att testa |
| Integrera Lantmäteriet (riktig API-nyckel i `.env`) | API-nycklar aldrig i PR-agenten |
| SMTP-e-postkonfiguration | Kräver lokal SMTP-server för test |
| Playwright E2E-tester mot `localhost:5173` | Kräver körande dev-server |
| Debugga Prisma-queries mot lokal PostgreSQL | Kräver lokal DB-instans |
| Konfigurera BankID PFX-certifikat | Säkerhetskänslig fil, aldrig i repo |
| Anpassa `docker-compose.yml` för lokal miljö | Kräver Docker lokalt |

**Snabbstart lokalt:**
```bash
npm install
cp .env.example .env.local   # fyll i GEMINI_API_KEY m.fl.
npm run db:migrate
npm run dev                   # startar på http://localhost:5173
```

### Gör INTE det här:
- Committa API-nycklar eller certifikat
- Köra `npm run db:migrate` mot produktionsdatabas

---

# Nuläge (22 mars 2026)

| Kvalitetsmått | Status |
|---|---|
| TypeScript | ✅ 0 fel |
| Lint (ESLint) | ✅ 0 fel |
| Build (`npm run build`) | ✅ Lyckat |
| Enhetstester (Vitest) | ✅ 185/185 pass (25 testfiler) |
| Integrationstester | ⚠️ Kräver lokal DB |
| E2E-tester (Playwright) | ⚠️ Kräver lokal server |

---

# 🗄️ DB-status (Prisma / PostgreSQL)

**Kräver**: `DATABASE_URL` i `.env.local` pekar på körande PostgreSQL-instans.

**Admin-UI**: ADMIN_CONSOLE → **"Databasstatus"** (sidebar-länk, `fa-database`) visar automatiskt dokumentantal, kravrader och kommuner via `GET /api/admin/db-stats`.

| Parameter | Värde |
|---|---|
| ORM | Prisma (v6) |
| Databas | PostgreSQL |
| Schema-fil | `prisma/schema.prisma` |
| Antal modeller | 28 |
| Antal migrationer | 6 (alla klara) |
| Repositories | 8 (`server/repositories/`) |
| In-memory mock | ❌ Nej — all data via Prisma |

## Admin routing (ADMIN_CONSOLE)
| Tab | Komponent |
|---|---|
| `admin-search` | `AdminSearchConsole(search)` |
| `admin-insight` | `AdminSearchConsole(insight)` |
| `admin-review` | `AdminMetadataReview` |
| `admin-gdpr` | `AdminGdprPanel` |
| `admin-db` | `AdminDbStatusPanel` ← **NY** (auto-laddar DB-statistik) |
| `admin-system` | `SystemFunctionalAnalysis` |

## Modeller (28 st)
`AuditTrail`, `AttachmentOccurrence`, `CaseCandidate`, `CaseNote`, `DocumentChunk`, `DocumentContent`, `DocumentMetadataEvidence`, `DocumentRecord`, `EmailMessage`, `ExtractedRequirement`, `KnowledgeEdge`, `KnowledgeNode`, `MetadataReviewQueue`, `Organisation`, `OutlookAttachment`, `PipelineRun`, `Project`, `ProjectMember`, `ProjectPlanState`, `PropertyAccessLog`, `RateLimitEntry`, `RequirementCase`, `RequirementCitation`, `RequirementRecord`, `SearchJob`, `SearchQueryLog`, `TokenRevocation`, `User`

## Migrationer (6 st)
| Migration | Innehåll |
|---|---|
| `20260301_init` | Grundschema |
| `20260302_requirements_model` | RequirementRecord m.fl. |
| `20260314005842_sync_schema_and_fix_drift` | Schemadrift-fix |
| `20260315_add_case_notes_and_attachment_fields` | CaseNote, fält |
| `20260315_add_rate_limit_table` | RateLimitEntry |
| `20260315_add_token_revocation` | TokenRevocation |

## Köra lokalt
```bash
cp .env.example .env.local
# Sätt DATABASE_URL=postgresql://... i .env.local
npm run db:migrate    # kör alla migrationer
npm run db:seed       # (frivilligt) seed-data
npm run dev           # startar på http://localhost:5173
```

---

# 🛠️ Verktygsval: rätt verktyg för rätt uppgift

## Kortsvaret

| Uppgift | Figma Make | Stitch (bolt.new / lovable.dev) | AI Studio | Copilot agent |
|---|---|---|---|---|
| Ny visuell vy från scratch | ✅ Bäst | ✅ Bra | ❌ Nej | ✅ Kan |
| Koppla existerande komponent till routing | ❌ Nej | ⚠️ Kräver kontext | ❌ Nej | ✅ **Gör detta här** |
| Design tokens / färger / spacing | ✅ Bäst | ✅ Bra | ❌ Nej | ⚠️ Manuellt |
| Full-stack feature (UI + API) | ❌ Nej | ✅ Bra | ❌ Nej | ✅ Bra |
| Finjustera Gemini-promptar | ❌ Nej | ❌ Nej | ✅ **Bäst** | ⚠️ Manuellt |
| Analysera PDF-miljödomar | ❌ Nej | ❌ Nej | ✅ **Bäst** | ❌ Nej |
| Interagera med riktig DB lokalt | ❌ Nej | ❌ Nej | ❌ Nej | ❌ → VS Code |
| Iterera på befintlig komponents layout | ✅ Bra | ✅ Bra | ❌ Nej | ✅ Kan |

## Detaljanalys

### Figma Make (rekommenderas för visuell polish)
**Passar för**:
- Omdesigna befintliga vyer (t.ex. `ExecutiveSummary`, `PermitPortalView`, `ProjectManagerView`) med bättre visuell hierarki
- Skapa konsistenta kort, tabeller, formulärlayout
- Uppdatera `tokens.json` / `tokens.css` med ett nytt designsystem

**Kräver** att du matar in filerna i rätt ordning (se `figma_make_context_manifest.md`):
1. `types.ts` → `constants.ts` → `index.tsx` → `components/App.tsx`
2. `tokens.json` + `tokens.css`
3. Den specifika komponentfilen du vill förbättra

**Begränsningar**:
- Kan inte koppla ihop routing, API-anrop eller event-handlers
- Kan inte testa bygget — output måste kopieras hit och köras av Copilot agent

### Google AI Studio (rekommenderas för prompt-tuning och dokumentanalys)
**Passar för**:
- Finjustera systempromptar för `mvpAiGatewayService`, `ragSearchService`, `execSummaryQueueService`
- Analysera PDF-miljödomar med Gemini 2.5 Pro (1M tokens kontextfönster)
- Testa och validera JSON-svar från Gemini innan koden ändras

**Kräver** att du laddar in rätt kontextfiler (se `ai_studio_context_manifest.md`):
- Välj modell: `gemini-2.5-pro` för djupanalys, `gemini-2.0-flash` för snabba iterationer
- Sätt `responseMimeType: application/json` för strukturerade svar

**Begränsningar**:
- Ingen tillgång till databasen eller servermiljön
- Ladda aldrig upp `.env` eller personuppgifter (GDPR)
- Output måste verifieras med TS/lint av Copilot agent innan den committas

### Stitch / Bolt.new / Lovable (rekommenderas för snabb full-stack MVP)
**Passar för**:
- Skapa en **ny** komplett vy med UI + logik i ett svep
- Iterera snabbt utan att behöva dela upp i design/kod-steg
- Generera formulär med validering, tabeller med sortering, modaler

**Kräver**:
- Att du laddar upp relevanta typfiler (`types.ts`, `constants.ts`) som kontext
- Manuell granskning av output innan det mergas (ingen testsvit körs)

**Begränsningar**:
- Har ingen tillgång till era specifika backend-endpoints utan explicit kontext
- Genererar ibland inkonsistent stilsättning om tokens inte laddas

### Copilot agent (denna agent — rekommenderas för inkoppling och polish)
**Passar för**:
- Koppla existerande men "lösa" komponenter (`MarketingHub`, `UploadModal`) till routing i `App.tsx`
- Sätta ihop en fungerande upload-endpoint (`POST /api/documents/upload`) utan lokal DB
- TS + lint-kontroll av alla genererade komponenter från Figma Make / Stitch

---

## Konkreta UI-uppgifter som återstår

### Uppgifter Copilot agent kan göra direkt (inga API-nycklar krävs)

| # | Uppgift | Fil | Status |
|---|---|---|---|
| 1 | Koppla `UploadModal` till `PermitPortalView` (knapp + routing) | `components/App.tsx` | ✅ Klart |
| 2 | Koppla `MarketingHub` till navigationen (ny tab i LOGISTICS_MARKET) | `components/App.tsx` | ✅ Klart |
| 3 | `WeatherRisk`-komponenten: visa tydligt felmeddelande vid saknad API-nyckel | `components/WeatherRisk.tsx` | ✅ Klart |
| 4 | `MOCK_PERMITS` → verkliga API-anrop i `App.tsx` och `GisRiskModule` | `components/App.tsx`, `components/GisRiskModule.tsx` | ⏳ Kräver lokal DB |

### Uppgifter för Figma Make (visuell förbättring)

| # | Uppgift | Filer att ladda in |
|---|---|---|
| 1 | Omdesigna `ExecutiveSummary` med bättre datapresentationskort | `types.ts` + `constants.ts` + `ExecutiveSummary.tsx` |
| 2 | Förbättra `PermitPortalView` formulärlayout och steg-för-steg-guide | `types.ts` + `PermitPortalView.tsx` + `ApplicationWizard.tsx` |
| 3 | Designa onboarding/välkomstskärm (saknas idag) | `types.ts` + `App.tsx` + `tokens.css` |
| 4 | Förbättra mobilanpassning (inga breakpoints i sidomenyn) | `App.tsx` + `tokens.css` |

### Uppgifter som kräver lokal server (VS Code / Stitch)

| # | Uppgift | Varför lokal |
|---|---|---|
| 1 | `POST /api/documents/upload` med multer + filsystemet | Kräver lokal disk + DB |
| 2 | BankID-certifikat (.pfx) konfiguration | Säkerhetskänslig fil |
| 3 | E2E Playwright-tester | Kräver `localhost:5173` |
| 4 | Staging-driftsättning (Docker + PostgreSQL) | Kräver Docker lokalt |

---

## Rekommenderat flöde

```
1. AI Studio       → finjustera Gemini-promptar och validera JSON-svar
2. Figma Make      → visuell förbättring av befintliga vyer → exportera ny TSX
3. Copilot agent   → granskar + kör TS/lint + kopplar routing + pushar PR
4. VS Code / Stitch → lokal server-funktioner (upload, BankID, E2E)
```

---

## Kvarstående arbete (prioritetsordning)
1. ~~**[Copilot agent]** Koppla `UploadModal` + `MarketingHub` till routing~~ ✅ Klart
2. ~~**[Copilot agent]** `WeatherRisk` felmeddelande vid saknad API-nyckel~~ ✅ Klart
3. ~~**[Copilot agent]** Unit-tester `transportDispatchService`, `metricsService`, `sguRiskService`~~ ✅ 176/176 pass
4. ~~**[Copilot agent]** GDPR: AdminGdprPanel + REST-endpoints~~ ✅ Klart
5. ~~**[Copilot agent]** Säkerhet: rateLimit.ts minnesläcka fixad, SECURITY.md skapad~~ ✅ Klart
6. ~~**[Copilot agent]** Google AI Studio: context manifest + prompt-bibliotek dokumenterat~~ ✅ Klart
7. **[AI Studio]** Finjustera systempromptar för `mvpAiGatewayService` och `ragSearchService`
8. **[Figma Make]** Visuell polish av `ExecutiveSummary` och `PermitPortalView`
9. **[VS Code]** `POST /api/documents/upload` endpoint med multer (multer installerat ✅)
10. **[VS Code]** Riktig Lantmäteriet-integration med OAuth2-nyckel
11. **[VS Code]** Permit-inlämning: ersätt `MOCK_QUEUED` med riktig endpoint
12. **[VS Code]** SMHI-väderintegration med riktig API-nyckel
13. **[VS Code]** E2E-tester mot körande app
14. **[DevOps]** Staging-driftsättning Docker + PostgreSQL + env-vars

## Testansvarsfördelning

| Typ | Vem | Kommando |
|---|---|---|
| Unit-tester (rena funktioner, mock DB) | **Copilot agent** | `npm run test` |
| TS-kontroll | **Copilot agent** | `npx tsc --noEmit` |
| Lint | **Copilot agent** | `npx eslint .` |
| Prompt-kvalitet (Gemini-tjänster) | **Google AI Studio** | interaktivt i webbläsaren |
| E2E mot lokal server | **VS Code / Codex** | `npx playwright test` |
| Visuell komponent-test | **Figma Make / Antigravity** | UI-preview i Figma |
| Integrationstester mot riktig DB | **VS Code / Codex** | behöver lokal PostgreSQL |

