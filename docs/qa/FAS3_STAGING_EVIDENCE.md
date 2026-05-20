# Fas 3 — Lokaliseringsutredning: bevis

## Lokal verifiering

| Kommando | Resultat |
| -------- | -------- |
| `npx vitest run tests/unit/localizationRoutes.test.ts` | 6/6 passerade (lokalt) |
| `npm run typecheck` | Befintliga fel i andra moduler kan kvarstå — Fas 3-filer ska vara gröna |

## Staging

```bash
npm run e2e:staging:localization
```

Kräver `STAGING_URL`, admin-inloggning och aktiva datakällor (NVR, RAA, VISS, PostGIS, valfritt SLU).

Miljövariabler (valfria):

- `E2E_LOC_PROJECT_ID` — projekt-ID (default `demo-project`)
- `E2E_LOC_LAT` / `E2E_LOC_LNG` — testkoordinat inom Sverige

## Strikt läge (staging/prod)

Aktiveras när `APP_ENV=staging|production` eller `LOCALIZATION_STRICT_SOURCES=true`.

- Externa källor markeras `unavailable` i stället för tyst tom fallback
- Rapport blockeras med **503** om för många externa källor saknas per plats

## API

- `POST /api/localization/generate-report`
- `POST /api/localization/generate-pdf-data`
- `POST /api/localization/export-pdf`
- `GET /api/localization/:projectId/audit-trail`

## Modulstruktur

- `server/modules/localization/localizationOrchestrator.ts`
- `server/services/localizationReportService.ts` (dataSources, warnings, SLU)
- `components/LocalizationStudyUI.tsx` (varningar + PDF-export)

## Ej staging-bevis

- `seed-localization-demo.ts` — endast lokal demo-seed
