# Figma Make Prompt – Miljöbeslut.se

## Syfte
Denna fil är kontextmall för Figma Make när du skapar eller uppdaterar UI-komponenter för Miljöbeslut.se.

## Importordning
Följ alltid `figma_make_context_manifest.md` för importordning.

## Kontrakt
Skapa eller uppdatera Figma-komponenter **endast** inom ramen för det befintliga strukturkontraktet i `figma-plugin/STRUCTURE_PROMPT.md`.

**Regler:**
- Inga nya toppnivåarkitekturer eller mode-nycklar.
- Bevara befintlig affärslogik, API- och state-flöden.
- Responsiv desktop + mobile.
- Använd alltid befintliga tokens (`tokens.css` och `tokens.json`).

## Mode-ordning (App.tsx)
- `LOGISTICS_MARKET`
- `PERMIT_PORTAL`
- `PROJECT_MANAGER`
- `COMPLIANCE_AUDIT`
- `ADMIN_CONSOLE`

## Design System Tokens
Importera och respektera dessa token-variabler:

```css
/* Från public/design-system.css */
--bg-main: #060607
--bg-card: #0F0F11
--primary: #6366F1   /* Indigo */
--secondary: #14B8A6  /* Teal */
--accent: #F43F5E    /* Rose */
--text-primary: #FFFFFF
--text-secondary: #94A3B8
```

```css
/* Från tokens.css (genereras från tokens.json) */
--color-primary-500: #2563EB
--radius-md: 12px
--space-4: 4px
--typography-body-md-font-family: "Lucida Sans Typewriter", sans-serif
```

## Typsnitt
- **Display/Rubriker:** Outfit (Google Fonts)
- **Brödtext/UI:** Inter (Google Fonts)
- **Mono/Tech:** Lucida Sans Typewriter

## Komponenter (befintliga, modifiera ej arkitektur)
- `components/App.tsx` – Top shell + mode navigation
- `components/PermitPortalView.tsx` – Tillståndportal
- `components/MarketIntelView.tsx` – Marknad/logistik
- `components/AdminSearchConsole.tsx` – Adminkonsol
- `components/ProjectManagerView.tsx` – Projektledning

## Figma Plugin
- Plugin-ID: `miljobeslut-ai-starter`
- API: `1.0.0`
- Manifest: `figma-plugin/manifest.json`

## Leverans
Figma Make levererar **specifikation/UI-spec** (text/JSON).  
**Copilot Agent implementerar** och commitar koden.

## Relaterade filer
- `figma_make_context_manifest.md` – Importordning
- `figma-plugin/STRUCTURE_PROMPT.md` – Strukturkontrakt
- `tokens.json` – Token-källa
- `tokens.css` – Genererade CSS-variabler
- `public/design-system.css` – Global design
- `src/figma-components/` – Exporterade Figma-komponenter
