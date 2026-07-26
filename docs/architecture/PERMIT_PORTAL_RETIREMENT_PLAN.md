# Permit Portal avvecklingsplan (legacy -> canonical)

Datum: 2026-05-25
Ägare: Plattform/Frontend + API
Status: Draft

## Mål

Avveckla legacy-läget `PERMIT_PORTAL` utan regressionsfel och styra all ny C-anmälan-funktionalitet till canonical flöde:

- UI: `Core_WORKFLOW` + `c-notification-mass`
- API: `/api/c-notification/mass/*`

## Nuvarande läge (verifierat)

Legacy finns kvar i flera lager:

- Lägesdefinition: `PERMIT_PORTAL` i [components/workspaceModes.ts](components/workspaceModes.ts)
- Routing: [components/AppContentRouter.tsx](components/AppContentRouter.tsx), [components/ProjectWorkspace.tsx](components/ProjectWorkspace.tsx)
- Preload/logik: [components/workspacePreload.ts](components/workspacePreload.ts)
- UI: [components/PermitPortalView.tsx](components/PermitPortalView.tsx)
- Tester som explicit förutsätter `PERMIT_PORTAL`: [tests/components/workspaceApp.test.tsx](tests/components/workspaceApp.test.tsx), [tests/components/projectWorkspace.test.tsx](tests/components/projectWorkspace.test.tsx), [tests/components/permitPortalView.test.tsx](tests/components/permitPortalView.test.tsx)

Canonical C-anmälan finns och är aktiv:

- UI: [components/admin/modules/c-notification-mass/CNotificationMassUI.tsx](components/admin/modules/c-notification-mass/CNotificationMassUI.tsx)
- API: [server/routes/cNotificationMass.routes.ts](server/routes/cNotificationMass.routes.ts)
- Staging-bevis: [docs/qa/staging-evidence/FAS2_STAGING_EVIDENCE.md](docs/qa/staging-evidence/FAS2_STAGING_EVIDENCE.md)

Notera att admin-modulen `permit-portal` är en separat tillståndsportal och ska inte blandas ihop med legacy-flödet:

- [components/admin/modules/permit-portal/PermitPortalModule.tsx](components/admin/modules/permit-portal/PermitPortalModule.tsx)
- Se även [docs/architecture/PERMIT_PORTAL_LEGACY.md](docs/architecture/PERMIT_PORTAL_LEGACY.md)

## Risker

1. Dubbel navigationsyta (legacy + canonical) gör användarflöden otydliga.
2. Testsvit binder kvar `PERMIT_PORTAL` och bromsar borttagning.
3. `PERMIT_PORTAL` används i projektstruktur/gates vilket kräver kontrollerad migrering.

## Avvecklingsstrategi (strangler)

### Fas A - Soft deprecation (1 PR)

1. Behåll kod, men ta bort aktiv exponering i primär navigation.
2. Tvinga handoff från legacy-vy till `Core_WORKFLOW` -> `c-notification-mass` för alla apply-/submit-liknande vägar.
3. Lägg tydlig telemetry/audit för legacy-träffar (antal, tab, användarroll).

Klarkriterier:

- Ingen primär CTA öppnar `PERMIT_PORTAL` i normal användarväg.
- Legacy-trafik kan mätas per dag.

### Fas B - Routing cleanup (1-2 PR)

1. Ta bort `PERMIT_PORTAL`-case i [components/AppContentRouter.tsx](components/AppContentRouter.tsx).
2. Ta bort lazy-import och case i [components/ProjectWorkspace.tsx](components/ProjectWorkspace.tsx) och [components/workspacePreload.ts](components/workspacePreload.ts).
3. Mappa historiska länkar/ids till `Core_WORKFLOW` där det behövs i resolver-logik.

Klarkriterier:

- Inga runtime-referenser till `PermitPortalView` i produktionsväg.
- Alla tidigare entry points landar i canonical modul.

### Fas C - Domain cleanup (1 PR)

1. Ta bort `PERMIT_PORTAL` från mode-katalog i [components/workspaceModes.ts](components/workspaceModes.ts) och relaterade UI-kort.
2. Migrera projektstruktur/gates från `PERMIT_PORTAL` till `Core_WORKFLOW`-domän där semantiskt korrekt.
3. Arkivera eller ta bort [components/PermitPortalView.tsx](components/PermitPortalView.tsx) efter verifierad stabil period.

Klarkriterier:

- `PERMIT_PORTAL` finns inte i aktiv användarmodell.
- Projektstruktur använder endast canonical moduler för C-anmälan.

### Fas D - Test & docs cleanup (1 PR)

1. Ersätt tester som förutsätter `PERMIT_PORTAL` med canonical assertions.
2. Uppdatera dokumentation och borttagningsnotis i changelog.
3. Verifiera E2E för C-anmälan, avlopp, lokalisering.

Klarkriterier:

- Inga komponenttester kräver `PERMIT_PORTAL`.
- QA pipeline grön.

## QA-checklista per fas

- `npm run typecheck`
- `npm run lint`
- `npm run test:component`
- `npm run test:integration`
- `npm run e2e:staging:c-mass`
- `npm run e2e:staging:all` (innan slutlig borttagning)

## Rollback-plan

1. Återaktivera mode-kortet för `PERMIT_PORTAL`.
2. Re-enable route-case i AppContentRouter/ProjectWorkspace.
3. Behåll feature flag för snabb återställning under övergång.

## Rekommenderad ordning

A -> B -> D (först) -> C (sist).

Skäl: minimerar risken att bryta kritiska flöden innan test- och dokumentationsbasen hunnit migreras.
