# Staging E2E — riktig staging per fokusmodul

Målet är **funktionsstabilitet**: varje fokusmodul ska kunna verifieras mot **staging** med egen beviskedja och ge spårbara resultat för [production-readiness-checklist.md](production-readiness-checklist.md).

## Förkrav

1. Deployad **staging**-URL med API och frontend (samma origin eller CORS korrekt konfigurerad).
2. Miljövariabler i shell eller CI:

- `**PLAYWRIGHT_BASE_URL`** — bas-URL till **frontend\*\* (t.ex. `https://staging.example.com`).
- `**PLAYWRIGHT_API_BASE_URL`\*\* — om API ligger på annan host än default (valfritt).
- `**E2E_ADMIN_USERNAME**` / `**E2E_ADMIN_PASSWORD**` (eller `ADMIN_CONSOLE_*`) — staging admin.

3. Playwright installerat: `npx playwright install` (första gången).

## Fokusmoduler

1. **Lokaliseringsutredning** — eget staging-flöde.
2. **C-anmälan** — eget staging-flöde.
3. **Enskilt avlopp** — eget staging-flöde.

## Kommando (automatiserade flöden)

```bash
cd Miljöbeslut.se
set PLAYWRIGHT_BASE_URL=https://din-staging-url
set E2E_ADMIN_USERNAME=...
set E2E_ADMIN_PASSWORD=...
npm run e2e:staging
```

På macOS/Linux:

```bash
export PLAYWRIGHT_BASE_URL=https://din-staging-url
export E2E_ADMIN_USERNAME=...
export E2E_ADMIN_PASSWORD=...
npm run e2e:staging
```

### Enskilt avlopp

```bash
npm run e2e:staging:avlopp
```

### C-anmälan

```bash
npm run e2e:staging:c-mass
```

Se `tests/e2e/staging-c-anmalan-mass.spec.ts`.

### Valfria flaggor

| Variabel                        | Betydelse                                                                                            |
| ------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `E2E_INCLUDE_VERTEX_FLOWS=true` | Kör även AI-tunga steg (t.ex. tillstånds-generering) som kan ta lång tid och kräva Vertex i staging. |

## Förväntat resultat

- Exit code **0** för respektive automatiserat flöde och rapporten visar rätt modulresultat.
- Vid fel: öppna Playwright HTML-rapport (`npx playwright show-report`) eller CI-artefakter.

## Koppling till checklista

Fyll i respektive modulrad i checklistor/PR-bevis med datum, kommando, utfall, ansvarig och artifact-länk.
