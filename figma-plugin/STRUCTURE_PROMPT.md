# Figma Prompt: Follow Existing Project Structure

## Prompt

Skapa `Home` i Figma men folj exakt den struktur som redan ar implementerad i koden. Leverera endast UI-spec och layout som mappar mot befintliga komponenter.

## Context

Struktur-kontrakt (maste foljas):

1. Top shell + mode navigation -> `components/App.tsx`
2. Permit portal-vy -> `components/PermitPortalView.tsx`
3. Market/logistik-vy -> `components/MarketIntelView.tsx`
4. Admin-vy -> `components/AdminSearchConsole.tsx`

Regler:

- Ingen ny toppniva-arkitektur eller nya mode-nycklar.
- Bevara befintlig affarslogik/API/state-flode.
- Responsive desktop + mobile.
- Anvand befintliga tokens (`tokens.css` och `tokens.json`).

Mode-ordning i appen:

- `LOGISTICS_MARKET`
- `PERMIT_PORTAL`
- `PROJECT_MANAGER`
- `COMPLIANCE_AUDIT`
- `ADMIN_CONSOLE`

## MCP Prompt Variant

Use the Figma MCP content from this file and target frame `Home`. Patch existing files only. Preserve business logic, API contracts, state flow, and mode keys. Enforce responsive behavior and existing tokens. Return node->component mapping.
