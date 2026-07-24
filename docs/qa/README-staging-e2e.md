# Staging E2E — riktig staging per fokusmodul

Målet är **PDF-ready end-to-end**: varje fokusmodul ska kunna verifieras mot **staging** med generate + export PDF för utskrift. **Myndighetsinlämning (submit) är medvetet deferred** tills externa avtal och BankID är på plats.

## Förkrav

1. Deployad **staging**-URL med API och frontend (samma origin eller CORS korrekt konfigurerad).
2. Miljövariabler i shell eller CI:

- `**PLAYWRIGHT_BASE_URL`** — bas-URL till **frontend** (t.ex. `https://staging.example.com`).
- `**PLAYWRIGHT_API_BASE_URL**` — om API ligger på annan host än default (valfritt).
- `**E2E_ADMIN_USERNAME**` / `**E2E_ADMIN_PASSWORD**` (eller `ADMIN_CONSOLE_*`) — staging admin.

3. Playwright installerat: `npx playwright install` (första gången).

## Fokusmoduler (PDF-ready)

| Modul                  | Slutsteg                                          | Submit   |
| ---------------------- | ------------------------------------------------- | -------- |
| Lokaliseringsutredning | `POST /api/localization/export-pdf`               | Deferred |
| C-anmälan schaktmassor | `GET /api/c-notification/mass/:caseId/export-pdf` | Deferred |
| Enskilt avlopp         | `GET /api/sewage/applications/:id/dossier`        | Deferred |

Tvärgående krav i alla tre specar:

- Human-in-the-loop-text i JSON-underlag
- Audit-spår efter generate/export
- Inga demo/mock-fallback-flaggor i staging

## Kommando (automatiserade flöden)

```bash
cd Miljöbeslut.se
set PLAYWRIGHT_BASE_URL=https://din-staging-url
set E2E_ADMIN_USERNAME=...
set E2E_ADMIN_PASSWORD=...
npm run e2e:staging:all
```

På macOS/Linux:

```bash
export PLAYWRIGHT_BASE_URL=https://din-staging-url
export E2E_ADMIN_USERNAME=...
export E2E_ADMIN_PASSWORD=...
npm run e2e:staging:all
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

### Lokaliseringsutredning

```bash
npm run e2e:staging:localization
```

Se `tests/e2e/staging-lokaliseringsutredning.spec.ts`.

### Kartlager och geodata

```bash
npm run e2e:staging:map-layers
```

Se `tests/e2e/staging-map-layers.spec.ts`. Verifierar:

- `GET /api/reference/map-layers` (katalog utan auth)
- Sample av `MAP_LAYER_CATALOG` och `GEODATA_SMOKE_CATALOG` med bbox

Tomma `features` med `meta.available: false` räknas som **degraded**, inte fail (samma semantik som `scripts/smoke/map-layers.ts`).

Valfritt: `E2E_LOC_LAT` / `E2E_LOC_LNG` styr probe-bbox (default Uppsala-område).

### Valfria flaggor

| Variabel                        | Betydelse                                                                                            |
| ------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `E2E_INCLUDE_VERTEX_FLOWS=true` | Kör även AI-tunga steg (t.ex. tillstånds-generering) som kan ta lång tid och kräva Vertex i staging. |

## Förväntat resultat

- Exit code **0** för `npm run e2e:staging:all` mot riktig staging-URL.
- Varje modulspec verifierar utskriftsbar PDF (`%PDF`-magic) samt human-in-the-loop i JSON-underlag.
- Vid fel: öppna Playwright HTML-rapport (`npx playwright show-report`) eller CI-artefakter.

## Koppling till checklista

Fyll i respektive modulrad i checklistor/PR-bevis med datum, kommando, utfall, ansvarig och artifact-länk.
