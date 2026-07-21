# Plan: CI/CD och importgränser (Fas 2)

**Syfte:** Förbereda automatiska regler så att **klient**, **routes** och **moduler** inte kringgår avsedda API-ytor — komplement till befintlig `npm run ci:arch:guard` (tunna routes).

**Status:** Plan — ej fullt implementerad.

## Nuvarande läge

- `scripts/ci/assert-no-routes-services-imports.ts`: `server/routes/**` får inte importera `../services/` eller `../repositories/` direkt.
- Frontend bundlas via Vite; risken är **djupa imports** från `services/*` eller `server/*` som av misstag når klientpaketet.

## Målbild (ESLint)

### A. Webb-frontend (`components/**`, `src/**`, `pages/**` — exakta globs enligt repo)

| Förbjudet | Tillåtet |
|-----------|----------|
| Import från `server/**` | HTTP-anrop till `/api/*`, delade **typer** i `types/` eller `@repo/*` om infört |
| Import från `services/**` som anropar Vertex/Prisma/filsystem | Endast `services/*` som uttryckligen markerats **browser-safe** (eller flytta till `client/lib/`) |
| Import från `@google-cloud/*`, `node:fs`, `prisma` | — |

**Verktyg:** `eslint-plugin-import` med `no-restricted-paths` eller `eslint-plugin-boundaries` med zoner:

- `zone: client` — endast `client`, `shared`, `types`
- `zone: server` — `server`, `services` (server-only del)

### B. Server-moduler (`server/modules/<x>/**`)

| Regel | Motivering |
|-------|------------|
| Ingen import av `server/modules/<y>/adapters/**` där `x ≠ y` | Tvingar läsning via `<y>/public` eller shared repository |
| Valfritt: endast **en** modul får importera `prisma` för given modellgrupp | Kräver att matrisen i `data_matrix.md` kodas som allowlist (steg 2b) |

*Start small:* inför först **client vs server**-gräns; modul-till-modul kommer när teamet växer.

### C. CI-pipeline

1. `npm run lint` inkluderar nya regler.
2. `npm run ci:arch:guard` oförändrat eller utökat med ett andra skript `ci:arch:client-server` som kör `grep`/AST-check om ESLint inte täcker alla fall.

## Implementeringsordning

1. Inventera **alla** imports från `services/` i `*.tsx` under `components/` (och ev. `src/`).
2. Lägg till ESLint-override för **browser-safe** lista (få filer).
3. Aktivera `no-restricted-paths` med tydliga felmeddelanden som länkar till denna plan.
4. (Valfritt) `dependency-cruiser` för grafisk rapport i PR.

## Ansvar

- **Plattform:** uppdaterar ESLint + CI.  
- **Produkt:** godkänner undantag (tillfälliga `eslint-disable` endast med ADR eller issue-länk).
