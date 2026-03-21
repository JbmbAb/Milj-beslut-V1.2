# Arbetssätt
- Kör aldrig full omindexering utan explicit godkännande.
- Tolka frågor som frågor, inte som körorder.
- Bekräfta innan jobb som kan ta mer än 5 minuter.
- Om något verkar ologiskt: stoppa och fråga.

# Kvalitetskrav
- All programmering måste vara juridiskt hållbar.
- Human in the loop ska finnas i alla steg.

---

# Arbetsfördelning: tre verktyg

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

## 🎨 Figma Make / "antigravity" — UI-design och komponentprototyper
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

# Nuläge (20 mars 2026)

| Kvalitetsmått | Status |
|---|---|
| TypeScript | ✅ 0 fel |
| Lint (ESLint) | ✅ 0 fel |
| Build (`npm run build`) | ✅ Lyckat |
| Enhetstester (Vitest) | ✅ 153/153 pass |
| Integrationstester | ⚠️ Kräver lokal DB |
| E2E-tester (Playwright) | ⚠️ Kräver lokal server |

---

# 🛠️ Verktygsval: UI-slutförande — Figma Make ELLER Stitch?

## Kortsvaret

| Uppgift | Figma Make | Stitch (bolt.new / lovable.dev) | Copilot agent |
|---|---|---|---|
| Ny visuell vy från scratch | ✅ Bäst | ✅ Bra | ✅ Kan |
| Koppla existerande komponent till routing | ❌ Nej | ⚠️ Kräver kontext | ✅ **Gör detta här** |
| Design tokens / färger / spacing | ✅ Bäst | ✅ Bra | ⚠️ Manuellt |
| Full-stack feature (UI + API) | ❌ Nej | ✅ Bra | ✅ Bra |
| Interagera med riktig DB lokalt | ❌ Nej | ❌ Nej | ❌ → VS Code |
| Iterera på befintlig komponents layout | ✅ Bra | ✅ Bra | ✅ Kan |

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
1. Figma Make → visuell förbättring av befintliga vyer → exportera ny TSX
2. Copilot agent → granskar + kör TS/lint + kopplar routing + pushar PR
3. VS Code / Stitch → lokal server-funktioner (upload, BankID, E2E)
```

---

## Kvarstående arbete (prioritetsordning)
1. ~~**[Copilot agent]** Koppla `UploadModal` + `MarketingHub` till routing~~ ✅ Klart
2. ~~**[Copilot agent]** `WeatherRisk` felmeddelande vid saknad API-nyckel~~ ✅ Klart
3. ~~**[Copilot agent]** Unit-tester `transportDispatchService`, `metricsService`, `sguRiskService`~~ ✅ 153/153 pass
4. **[Figma Make]** Visuell polish av `ExecutiveSummary` och `PermitPortalView`
5. **[VS Code]** `POST /api/documents/upload` endpoint med multer (multer installerat ✅)
6. **[VS Code]** Riktig Lantmäteriet-integration med OAuth2-nyckel
7. **[VS Code]** Permit-inlämning: ersätt `MOCK_QUEUED` med riktig endpoint
8. **[VS Code]** SMHI-väderintegration med riktig API-nyckel
9. **[VS Code]** E2E-tester mot körande app
10. **[DevOps]** Staging-driftsättning Docker + PostgreSQL + env-vars

## Testansvarsfördelning

| Typ | Vem | Kommando |
|---|---|---|
| Unit-tester (rena funktioner, mock DB) | **Copilot agent** | `npm run test` |
| TS-kontroll | **Copilot agent** | `npx tsc --noEmit` |
| Lint | **Copilot agent** | `npx eslint .` |
| E2E mot lokal server | **VS Code / Codex** | `npx playwright test` |
| Visuell komponent-test | **Figma Make / Antigravity** | UI-preview i Figma |
| Integrationstester mot riktig DB | **VS Code / Codex** | behöver lokal PostgreSQL |

