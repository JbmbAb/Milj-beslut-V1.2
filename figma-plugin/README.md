# Figma AI Starter

This is a minimal Figma plugin starter that can run without a build step and call the same backend AI motor as Miljobeslut.

## Files

- `manifest.json` plugin definition
- `code.js` Figma canvas logic
- `ui.html` prompt UI for `/api/figma/ai`

## Import in Figma

1. Open Figma desktop app.
2. Go to Plugins -> Development -> Import plugin from manifest...
3. Select `figma-plugin/manifest.json`.
4. Run from Plugins -> Development -> Miljobeslut AI Starter.

## Backend integration

The plugin is wired to:

- `POST http://localhost:8787/api/figma/ai`
- Body: `{ "prompt": string, "context"?: string, "style"?: "brief" | "detailed" | "bullet" }`
- Header: `Authorization: Bearer <token>` (required in secured environments; optional for localhost plugin testing)

Response shape:

- Success: `{ "ok": true, "text": "..." }`
- Error: `{ "ok": false, "error": "..." }`

## How it works

- Write a prompt in the UI.
- Add context/style if needed.
- Click `Use app structure` to force generation against current project architecture.
- Select `Generation mode`:
- `Build interface` creates a full UI frame from AI spec.
- `Text answer` creates a text result frame.
- Set endpoint and token.
- The plugin creates a frame in canvas with prompt + AI output.

## Structure lock (recommended)

When generating in Figma, keep this mapping fixed so design follows code structure:

- `Home shell + mode navigation` -> `components/App.tsx`
- `Permit portal sections` -> `components/PermitPortalView.tsx`
- `Market/logistics sections` -> `components/MarketIntelView.tsx`
- `Admin search/insight sections` -> `components/AdminSearchConsole.tsx`

Rules:

- Do not create new top-level modes outside `LOGISTICS_MARKET`, `PERMIT_PORTAL`, `PROJECT_MANAGER`, `COMPLIANCE_AUDIT`, `ADMIN_CONSOLE`.
- Preserve current business logic/API/state flows; only patch UI.
- Reuse existing design tokens in `tokens.css` and `tokens.json`.
