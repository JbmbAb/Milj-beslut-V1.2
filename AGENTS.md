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

# Nuläge (17 mars 2026)

| Kvalitetsmått | Status |
|---|---|
| TypeScript | ✅ 0 fel |
| Lint (ESLint) | ✅ 0 fel |
| Build (`npm run build`) | ✅ Lyckat |
| Enhetstester (Vitest) | ✅ 113/113 pass |
| Integrationstester | ⚠️ Kräver lokal DB |
| E2E-tester (Playwright) | ⚠️ Kräver lokal server |

## Kvarstående arbete (prioritetsordning)
1. **Dokumentuppladdning** — `POST /api/documents/upload` endpoint saknas → gör i VS Code
2. **Riktig Lantmäteriet-integration** — nu mock-fallback → gör i VS Code med riktig API-nyckel
3. **Permit-inlämning** — `submitPermitToAuthority` returnerar `MOCK_QUEUED` → gör i VS Code
4. **SMHI-väderintegration** — stub-only → gör i VS Code
5. **E2E-tester** — Playwright-tester finns men kräver körande app → gör i VS Code
6. **Staging-driftsättning** — Docker + PostgreSQL + env-vars → gör i VS Code / DevOps

