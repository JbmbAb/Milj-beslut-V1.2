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
- Header: `Authorization: Bearer <token>` (required)

Response shape:

- Success: `{ "ok": true, "text": "..." }`
- Error: `{ "ok": false, "error": "..." }`

## How it works

- Write a prompt in the UI.
- Add context/style if needed.
- Select `Generation mode`:
- `Build interface` creates a full UI frame from AI spec.
- `Text answer` creates a text result frame.
- Set endpoint and token.
- The plugin creates a frame in canvas with prompt + AI output.
