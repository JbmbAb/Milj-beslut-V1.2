# Arkitekturskuld — roadmap (2026-06-09)

Uppföljning av plattformsanalys. Kompletterar [modulregister_ombyggnad.md](../architecture/modulregister_ombyggnad.md) och [PERMIT_PORTAL_RETIREMENT_PLAN.md](../architecture/PERMIT_PORTAL_RETIREMENT_PLAN.md).

## Målbild

```
components/ + app/  ──►  src/ (en entry, feature-moduler)
server/routes       ──►  server/modules/*/public.ts (facade)
server/services/*   ──►  services/<domain>/ eller packages/* (AGENTS.md)
scripts/import/*    ──►  manifest-pipeline (Mimers Brunn) + tunna CLI-wrappers
```

## Fas A — Avveckling legacy-ytor (4–6 veckor)

### Permit Portal (DEPRECATED)

| Steg | Åtgärd | Filer |
|------|--------|-------|
| A1 | Dölj från `AppContentRouter` / portfolio om inte explicit flag | `components/AppContentRouter.tsx`, `PriorityModulePortfolio.tsx` |
| A2 | Redirect UI till Core workflow + canonical permit API | `PermitPortalView.tsx` → banner + länk |
| A3 | Ta bort E2E som endast testar legacy portal | `tests/e2e/*` |
| A4 | Radera routes när trafik = 0 i staging metrics | Se retirement plan |

### Sewage legacy alias

| Steg | Åtgärd |
|------|--------|
| B1 | Deprecate `sewage.legacy-alias.routes.ts` — logga `Deprecation` header |
| B2 | Migrera klienter till `sewage.applications.routes.ts` |
| B3 | Ta bort alias efter 1 release-cykel |

## Fas B — Service → modul (8–12 veckor)

Prioriterad ordning (affärsvärde × coupling):

1. **Evidence** — redan command/query-mönster; använd som mall
2. **Sewage / C-anmälan / Localization** — staging-moduler; flytta logik från `server/services/` in i `server/modules/<name>/`
3. **Legal ingest** — separera ingest / index / sök
4. **GIS read path** — `postgisLayerService` + registry under `server/modules/gis/`

CI guard idag: routes får inte importera `server/services/` direkt. **Nästa steg:** modul-facader får inte re-exportera mer än 3 legacy-anrop per fil (lint-regel eller codemod).

## Fas C — Frontend enhetlig (`src/`) (6–8 veckor)

| Steg | Åtgärd |
|------|--------|
| C1 | Flytta `components/app/*` → `src/app/` |
| C2 | Admin-moduler → `src/features/admin/` |
| C3 | En `src/main.tsx` + path aliases; ta bort `app/` Remix-rester |
| C4 | Uppdatera Vite/tsconfig paths |

## Fas D — Repo-hygien

| Mapp | Beslut |
|------|--------|
| `legacy/` | Behåll endast `remix-poc/` (testreferens) och `experimental/bankComplianceProfileService.ts` (test). Produktionslogistik flyttad till `server/modules/logistics/services/`. |
| `examensrepo/` | Borttaget ur aktiv docs; historik i git om behövs |
| `.quarantine/` | KASSERA efter inventering |
| `training/` | ARKIVERA om ej aktiv |

## Mätetal (kvartalsvis)

- Antal filer i `server/services/` (mål: −30% per kvartal)
- Antal `TODO(Mimers Brunn)` i `scripts/import/` (mål: −50%)
- Orphan-testkataloger (`tests/services`, `tests/v2`) — koppla eller ta bort
- Coverage gaps: `postgisLayerService`, `importPathService`, `datasource.routes.ts`

## Referenser

- [mimers-brunn-offline-first.md](../architecture/mimers-brunn-offline-first.md)
- [STRUCTURE_REFACTOR_2026-05.md](../architecture/STRUCTURE_REFACTOR_2026-05.md)
- [evidence public.ts](../../server/modules/evidence/public.ts)
