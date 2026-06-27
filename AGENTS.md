# Arbetssätt
- Kör aldrig full omindexering utan explicit godkännande.
- Tolka frågor som frågor, inte som körorder.
- Bekräfta innan jobb som kan ta mer än 5 minuter.
- Om något verkar ologiskt: stoppa och fråga.

# Kvalitetskrav
- All programmering måste vara juridiskt hållbar.
- Human in the loop ska finnas i alla steg.

---

# 🤖 AI-verktygsdirektiv – Milj-beslut-V1.2

## Beslut: vilka AI-verktyg som BEHÅLLS vs AVVECKLAS

| Verktyg | Status | Roll | Motivering |
|---|---|---|---|
| **GitHub Copilot Agent** (denna) | ✅ BEHÅLLS – PRIMÄR | Skriver, testar, commitar all kod | Ser hela kodbasen, kör TS+ESLint+Vitest före varje commit, enda AI med direkt repo-access |
| **Google AI Studio** | ✅ BEHÅLLS – SEKUNDÄR | Gemini-prompter, UI-prototyper, dataanalys | Bäst på Gemini 2.0 Flash-anrop och snabb prototypning – levererar TEXT, inte commits |
| **Figma Make** | ✅ BEHÅLLS – DESIGN | UI-spec och layout-beskrivningar | Bäst på visuell specifikation – levererar SPECIFIKATION, inte kod-commits |
| **Google Stitch** | ⚠️ BEGRÄNSAD – METRICS ONLY | Synkar coverage-metrics mot `stitch.json` | Endast `scripts/sync-stitch.ts` + `stitch.json` – inga kod-commits, inga branchoperationer |
| **VS Code / Cursor / Copilot (lokalt)** | ✅ BEHÅLLS – LOKAL UI | Tailwind-styling, inline autocomplete, lokala fixar | Komplement till Copilot Agent för snabba visuella tweaks i editorn |
| **Antigravity** | ❌ AVVECKLAS | Inget aktivt syfte identifierat i repot | Inga filer, inga configs, ingen integrerad koppling – avvecklas omedelbart |

---

## Regler per verktyg

### ✅ GitHub Copilot Agent (PRIMÄR – denna)
- **Enda AI som commitar kod** till repot
- Kör alltid `npx tsc --noEmit`, `npx eslint .`, `npx vitest run` före commit
- Följer human-in-the-loop: du granskar och godkänner PR före merge
- Ansvarar för: backend, services, repositories, tester, CI/CD, AGENTS.md

### ✅ Google AI Studio (SEKUNDÄR)
- Används för: Gemini API-prompts, analysera JSON-data, snabb UI-prototyp i webbgränssnitt
- Levererar **text/specifikation** till dig → du ber Copilot Agent implementera det
- Commitar ALDRIG direkt till repot
- Kontextfil: `figma_make_context_manifest.md` (mata in i rätt ordning)

### ✅ Figma Make (DESIGN)
- Används för: wireframes, komponentlayouter, token-kartor
- Följer alltid `figma-plugin/STRUCTURE_PROMPT.md` – inga nya mode-nycklar
- Levererar **design-spec** → Copilot Agent implementerar komponenten
- Commitar ALDRIG direkt

### ⚠️ Google Stitch (BEGRÄNSAD)
- Kvar enbart för metrics-sync via `scripts/sync-stitch.ts`
- Kräver `STITCH_PROJECT_URL` + `STITCH_API_KEY` i `.env`
- Modifierar INTE kod, komponenter eller scheman
- Om Stitch inte används aktivt inom 60 dagar → avvecklas helt

### ❌ Antigravity (AVVECKLAS)
- Inga konfigurationsfiler, inga integrationer, ingen aktiv roll identifierad
- Stäng eventuell licens/prenumeration om du har en
- Om en framtida specifik funktion behövs från Antigravity – ta upp det explicit

---

## Flöde: vem gör vad

```
Du (JbmbAb)
    │
    ├─► Figma Make   ──► UI-spec (text)  ──┐
    ├─► AI Studio    ──► Gemini-prompt   ──┤──► Du beskriver för Copilot Agent
    ├─► Stitch       ──► metrics-rapport ──┘
    │
    └─► GitHub Copilot Agent ──► kod + tester + commit ──► PR ──► Du godkänner
```

**Gyllene regel:** En AI commitar. Det är Copilot Agent (jag). Alla andra bidrar med input.

---

## AI-modellval – vilket verktyg för vad?

| Uppgift | Verktyg | Modell | Kontextfönster |
|---|---|---|---|
| Daglig kodgenerering (1–10 filer) | Cursor + Copilot Agent | Claude 3.5 Sonnet | 200 000 tokens |
| Helikopteranalys av hela kodbasen | Google AI Studio | Gemini 1.5 Pro | 2 000 000 tokens |
| Komplex logisk bugg (GIS/AI-motor) | ChatGPT | o1 / o3-mini | 128 000 tokens |
| CI/CD, tester, commit | GitHub Copilot Agent | – | hel kodbas via RAG |

### Cursor-inställningar (slå på en gång)
```
Settings → Features → Codebase Indexing → Enable ✓
```
Använd `@Codebase`, `@server/repositories`, `@AGENTS.md`, `@prisma/schema.prisma` som kontextflaggor.
`.cursorignore` håller brus (node_modules, CSV-filer, package-lock.json) borta från indexet.

### Full Context Dump (för Gemini 1.5 Pro)
```bash
# Generera hela kodbasen som en fil (exkluderar automatiskt CSV, package-lock, binärer)
npx repomix
# → repomix-output.xml skapas (ignoreras av .gitignore)
# → Ladda upp i Google AI Studio → Gemini 1.5 Pro
# → Använd prompt-mallen: docs/templates/context-dump-prompt.md
```

Fullständig guide: **`docs/architecture/ai-model-selection.md`**

---

## Konfliktförebyggande

1. Figma Make och AI Studio gör **aldrig** direkta git-commits
2. Stitch-scriptet körs **manuellt** (`npx ts-node scripts/sync-stitch.ts`) – inte automatiskt i CI
3. Alla kodändringar går via Copilot Agent PR → du godkänner → merge
4. Innan varje ny Copilot-session: `git pull` i VS Code för att synka

---

## Cursor Cloud specific instructions

Single full-stack app (`miljobeslut-se-2.0`): Vite + React frontend (port **3000**), Express + Prisma backend (port **8787**), PostgreSQL + pgvector (port **5432**). The Vite dev server proxies only `/api/*` to the backend (see `vite.config.ts`). Standard scripts live in `package.json`; QA flow is documented in `README.md`.

The update script (`npm install` + `npx prisma generate`) runs automatically on VM start. The notes below cover what it does NOT do.

- **PostgreSQL is installed locally via apt (not Docker).** Docker is unavailable in this environment; the `docker-compose.yml` Postgres is replaced by a local `pgvector/pg16` cluster. Start it each session with `sudo pg_ctlcluster 16 main start`. Credentials match the compose file: user `miljobeslut`, password `password`, db `miljobeslut`. Note `.env.example` ships a different (`riskguard`) `DATABASE_URL` — the working local value is `postgresql://miljobeslut:password@localhost:5432/miljobeslut`.
- **`.env` is committed-out of git but already present in the VM** with dev values (JWT secrets, `LANTMATERIET_OPEN_MODE=true`, local `DATABASE_URL`, admin console creds). The backend's `assertSecurityEnv()` throws at boot unless `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `LANTMATERIET_BASE_URL` and a Lantmäteriet credential (or `LANTMATERIET_OPEN_MODE=true`) are set.
- **Gotcha — start the backend with `--env-file`.** `npm run dev:server` / `npm start` do NOT reliably load `.env`: `assertSecurityEnv()` runs at module-import time, before `loadEnv.ts` executes (ESM hoisting), so the server crashes with "Missing required security env variables". Start it instead with `node --env-file=.env --import tsx server/index.ts` (or export the vars into the shell first). Frontend is just `npm run dev`.
- **DB schema setup** (already applied; rerun after schema changes): `npx prisma migrate deploy`, then `psql -f scripts/db/init-search.sql` to add the pgvector column/index (it degrades gracefully if pgvector is absent).
- **Health/verify**: `curl http://localhost:8787/health` should return `{ ok: true, db: "ok" }`. `/health` is NOT proxied through Vite (only `/api`), so hit port 8787 directly.
- **Hello-world / admin login**: POST `/api/admin/auth/login` with `admin` / `admin-dev-password` (from `.env`) returns JWT tokens; in the UI use the Administrator module → "Logga in", then "Skapa projekt". Most external integrations (Gemini, OpenAI, BankID, SLU, Lantmäteriet licensed lookups) require real API keys and degrade gracefully without them.
