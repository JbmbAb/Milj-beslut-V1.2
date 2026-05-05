# Design System Checkpoint – 2026-05-05

**Branch:** `copilot/checkpointdesign-system-base-20260505`  
**Base commit:** `11ee3d4`  
**Datum:** 2026-05-05  
**Syfte:** Bevara designsystem/Figma-underlag innan cloud-migrering

---

## Ingående designsystemfiler

| Fil | Roll |
|---|---|
| `tokens.json` | Design tokens (färger, spacing, radier, typografi) – källa för `tokens.css` |
| `tokens.css` | Genererade CSS-variabler från tokens.json (`npm run tokens:build`) |
| `figma_make_context_manifest.md` | Inmatningsordning för Figma Make – styr vilka filer AI:n ser, i vilken sekvens |
| `figma-plugin/manifest.json` | Figma-pluginets metadata (name, id, api-version, permissions) |
| `figma-plugin/code.js` | Figma-pluginets logik (körs i sandlådan i Figma) |
| `figma-plugin/ui.html` | Figma-pluginets UI (öppnas i iframe i Figma) |
| `figma-plugin/STRUCTURE_PROMPT.md` | Prompt-kontrakt för Figma Make: följ befintliga mode-nycklar, inga nya top-level-lägen |
| `figma-plugin/README.md` | Plugin-dokumentation |

---

## Tokeninnehåll (tokens.json → tokens.css)

```css
--color-primary-500: #2563EB
--radius-md: 12px
--space-4: 4px
--typography-body-md-font-family: "Lucida Sans Typewriter", sans-serif
--typography-body-md-font-weight: 400
--typography-body-md-font-size: 16px
--typography-body-md-line-height: 24px
```

---

## Valideringsresultat (körda 2026-05-05)

| Verktyg | Resultat |
|---|---|
| `npm run typecheck` (tsc --noEmit) | ✅ Inga fel |
| `npm run lint` (eslint .) | ✅ 0 fel, 1 warning (orelaterad: `beforeEach` unused i mapView.test) |
| `npm run test:unit` (vitest) | ✅ 119 testfiler, 1031 tester – alla godkända |

---

## Kvarvarande ändringar / nästa steg

- Inga unstaged ändringar – arbetstree är rent.
- **Nästa steg:**
  1. Godkänn PR → merge till main
  2. Tagga release: `git tag design-system-base-20260505`
  3. Inled cloud-migrering (GCP Cloud Run / cloudbuild.yaml)
  4. Uppdatera tokens vid ny Figma-leverans: `npm run tokens:build`

---

## Regler enligt AGENTS.md

- Figma Make och AI Studio commitar **aldrig** direkt – levererar spec till Copilot Agent
- Enda AI med commit-rättigheter: GitHub Copilot Agent (denna)
- Alla kodändringar: PR → granskning → merge (human-in-the-loop)
