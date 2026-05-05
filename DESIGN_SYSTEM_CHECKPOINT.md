# Design System Checkpoint – Miljöbeslut.se

**Skapad:** 2026-05-05  
**Branch:** `checkpoint/design-system-base-20260505` (levererad via PR `copilot/create-design-checkpoint`)  
**Bas:** `origin/main` @ `2c69123` (Merge PR #2)  
**Syfte:** Säkra en trygg, committad designbas inför fortsatt Figma/design system-arbete.

---

## Kvalitetsstatus (kört vid checkpointskapande)

| Kontroll | Resultat |
|---|---|
| `npx tsc --noEmit` | ✅ Inga fel |
| `npx eslint .` | ✅ 0 fel, 1 pre-existing warning |
| `npx vitest run` | ✅ 1 477 tester godkända, 20 hoppade |

---

## Designbasens filer (bekräftade i origin/main)

### 🎨 Design Tokens

| Fil | Syfte |
|---|---|
| `tokens.json` | Källa för alla designtokens (färg, typografi, spacing, radius) |
| `tokens.css` | Genererad CSS med CSS custom properties – byggs via `npm run tokens:build` |
| `public/design-system.css` | Technical Dark design system – globala klasser och CSS-variabler |
| `scripts/build-tokens-css.mjs` | Token-byggarskript: `tokens.json → tokens.css` |

**Nuvarande tokens (tokens.json):**
- `--color-primary-500: #2563EB`
- `--radius-md: 12px`
- `--space-4: 4px`
- `--typography-body-md-*`: Lucida Sans Typewriter, 400, 16px/24px

**Design system (public/design-system.css):**
- Färgpalett: `--primary: #6366F1` (Indigo), `--secondary: #14B8A6` (Teal), `--accent: #F43F5E` (Rose)
- Typsnitt: Outfit (rubriker), Inter (brödtext)
- Klasser: `.tech-card`, `.btn-primary`, `.gradient-text`, `.glow-*`

### 🔌 Figma-integration

| Fil | Syfte |
|---|---|
| `figma-plugin/manifest.json` | Plugin-metadata (name: "Miljobeslut AI Starter", api: 1.0.0) |
| `figma-plugin/code.js` | Plugin-kod |
| `figma-plugin/ui.html` | Plugin-UI |
| `figma-plugin/README.md` | Instruktioner för Figma-plugin |
| `figma-plugin/STRUCTURE_PROMPT.md` | Strukturkontrakt för Figma Make – inga nya mode-nycklar |
| `figma_make_context_manifest.md` | Importordning för Figma Make AI-kontext |
| `src/figma-components/index.ts` | Export av Figma-genererade komponenter |
| `src/figma-components/manifest.json` | Mappning: Figma-nod → React-komponent |
| `src/figma-components/user-dashboard.tsx` | Exporterad UserDashboard-komponent (Figma-nod: NsXMGXB0ljuk3l1D0NOVyK) |
| `scripts/export-figma.ts` | Skript för att hämta och exportera Figma-komponenter |

### 📊 Stitch (metrics)

| Fil | Syfte |
|---|---|
| `stitch.json` | Google Stitch-projektkonfiguration (projectId: 9118488730778694849) |
| `scripts/sync-stitch.ts` | Synkar coverage-metrics manuellt mot Stitch |

### 📋 Kontextdokumentation

| Fil | Syfte |
|---|---|
| `FIGMA_MAKE_PROMPT.md` | Prompt-mall för Figma Make (se nedan) |
| `STITCH_PROMPT.md` | Prompt-mall för Stitch-synk (se nedan) |
| `AGENTS.md` | AI-arbetsfördelning och verktygsregler |
| `figma-plugin/STRUCTURE_PROMPT.md` | Figma Make strukturkontrakt |
| `figma_make_context_manifest.md` | Figma Make importordning |

---

## Filer som SAKNAS i origin/main men refereras

Följande filer nämns i designsystemkontexten men finns inte committade till origin/main.
De finns troligen lokalt hos användaren på `main` (≈111 commits lokalt framför origin/main).

| Fil | Status | Åtgärd |
|---|---|---|
| `components/theme/designTokens.ts` | ❌ Saknas | Pusha från lokal main |
| `components/admin/admin-tokens.css` | ❌ Saknas | Pusha från lokal main |
| `components/ui/*` | ❌ Saknas | Pusha från lokal main |
| `FIGMA_MAKE_PROMPT.md` | ✅ Skapad i denna checkpoint | Se filen |
| `STITCH_PROMPT.md` | ✅ Skapad i denna checkpoint | Se filen |

---

## Branchanalys

| Branch | Status | Designunderlag |
|---|---|---|
| `origin/main` @ `2c69123` | ✅ **Rekommenderad designbas** | Komplett med tokens, plugin, stitch |
| `copilot/create-design-checkpoint` | ✅ Denna checkpoint | Baserad på origin/main + checkpoint-filer |
| `copilot/session-bundle-20260503` | ❌ Finns ej på remote | Endast lokalt – kräver review |
| `feat/2026-04-29-worktree-batch` | ❌ Finns ej på remote | Endast lokalt – kräver review |

**Slutsats:** `origin/main` är den mest kompletta och säkra designbasen på remote.  
Lokalt är `main` (≈111 commits framför) potentiellt mer komplett – **pushas separat efter review**.

---

## Commit-information

| Egenskap | Värde |
|---|---|
| Branch | `copilot/create-design-checkpoint` |
| Basbranch | `origin/main` @ `2c69123` |
| Checkpointfiler | `DESIGN_SYSTEM_CHECKPOINT.md`, `FIGMA_MAKE_PROMPT.md`, `STITCH_PROMPT.md` |

---

## Nästa steg inför Figma Design System Library

1. **Säkra lokala ändringar:** Pusha lokal `main` (111 commits) till en ny branch (t.ex. `feat/local-main-sync`) för review.
2. **Merge designtokens:** Säkerställ att `components/theme/designTokens.ts`, `components/ui/*` och `components/admin/admin-tokens.css` pushas och mergas.
3. **Utöka tokens.json:** Lägg till fler tokens (shadows, animation, breakpoints) för ett komplett designsystem.
4. **Figma → Kod pipeline:** Kör `npm run figma:export` (kräver `FIGMA_TOKEN` i `.env`) för att hålla `src/figma-components/` uppdaterat.
5. **Tokens → CSS:** Kör `npm run tokens:build` efter varje token-uppdatering.
6. **Stitch metrics:** Kör `npx ts-node scripts/sync-stitch.ts` manuellt (ej i CI).
7. **Design Library i Figma:** Importera `figma-plugin/STRUCTURE_PROMPT.md` och `figma_make_context_manifest.md` som kontext i Figma Make.
